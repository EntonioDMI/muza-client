//! Обработка звука нативного движка: преамп → 10 полос EQ → лимитер.
//!
//! Цепь и все числа перенесены 1:1 из прежнего движка (`audioEngine.ts`,
//! makeGraphNodes) — на обоих путях звук обязан быть одинаковым, иначе
//! переход с трека из кэша на потоковый было бы слышно.
//!
//! Считается в колбэке вывода, а не в декодере: правка полосы должна
//! отзываться сразу, а не через полторы секунды буфера. Стоимость подъёмная —
//! десять биквадов на канал это единицы процентов ядра.

/// Центральные частоты полос — те же, что видит человек в настройках.
pub const EQ_FREQS: [f32; 10] =
    [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
/// Добротность средних полос. 1.1 — из прежнего движка.
const PEAK_Q: f32 = 1.1;

const LIMITER_THRESHOLD_DB: f32 = -2.0;
const LIMITER_RATIO: f32 = 20.0;
const LIMITER_ATTACK_S: f32 = 0.003;
const LIMITER_RELEASE_S: f32 = 0.1;

fn db_to_lin(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Биквад по формулам RBJ — тем же, по которым считает BiquadFilterNode.
#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    /// Состояние на канал: фильтр помнит два прошлых входа и выхода.
    x1: [f32; 2],
    x2: [f32; 2],
    y1: [f32; 2],
    y2: [f32; 2],
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    LowShelf,
    Peaking,
    HighShelf,
}

impl Biquad {
    fn design(&mut self, kind: Kind, freq: f32, gain_db: f32, rate: f32) {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / rate;
        let (sin_w0, cos_w0) = w0.sin_cos();
        // Полки Web Audio считает при S = 1, отсюда множитель sqrt(2).
        let alpha = match kind {
            Kind::Peaking => sin_w0 / (2.0 * PEAK_Q),
            _ => sin_w0 / 2.0 * std::f32::consts::SQRT_2,
        };
        let sqrt_a = a.sqrt();

        let (b0, b1, b2, a0, a1, a2) = match kind {
            Kind::Peaking => (
                1.0 + alpha * a,
                -2.0 * cos_w0,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos_w0,
                1.0 - alpha / a,
            ),
            Kind::LowShelf => (
                a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha),
                2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0),
                a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha),
                (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha,
                -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0),
                (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha,
            ),
            Kind::HighShelf => (
                a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha),
                -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0),
                a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha),
                (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha,
                2.0 * ((a - 1.0) - (a + 1.0) * cos_w0),
                (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha,
            ),
        };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    #[inline]
    fn process(&mut self, x: f32, ch: usize) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1[ch] + self.b2 * self.x2[ch]
            - self.a1 * self.y1[ch]
            - self.a2 * self.y2[ch];
        self.x2[ch] = self.x1[ch];
        self.x1[ch] = x;
        self.y2[ch] = self.y1[ch];
        self.y1[ch] = y;
        y
    }
}

/// Вся цепь обработки одного потока вывода.
pub struct Dsp {
    bands: [Biquad; 10],
    /// Полосы, под которые посчитаны коэффициенты. Пересчёт стоит десяти
    /// синусов, поэтому делаем его только когда человек реально подвинул
    /// ползунок, а не на каждом буфере.
    designed_for: [f32; 10],
    designed_rate: f32,
    enabled: bool,
    /// Компенсация буста: громкая полоса садится к unity, и EQ не выталкивает
    /// сигнал за 0 dBFS. Приём из прежнего движка.
    preamp: f32,
    /// Огибающая лимитера в дБ — состояние между буферами.
    env_db: f32,
}

impl Dsp {
    pub fn new(rate: f32) -> Self {
        let mut dsp = Self {
            bands: [Biquad::default(); 10],
            designed_for: [f32::NAN; 10],
            designed_rate: rate,
            enabled: false,
            preamp: 1.0,
            env_db: LIMITER_THRESHOLD_DB,
        };
        dsp.set_bands(false, &[0.0; 10], rate);
        dsp
    }

    /// Пересобрать полосы, если что-то изменилось.
    pub fn set_bands(&mut self, enabled: bool, gains: &[f32; 10], rate: f32) {
        self.enabled = enabled;
        let same = self.designed_rate == rate
            && self
                .designed_for
                .iter()
                .zip(gains.iter())
                .all(|(a, b)| (a - b).abs() < f32::EPSILON);
        if same {
            return;
        }
        self.designed_rate = rate;
        self.designed_for = *gains;
        for (i, band) in self.bands.iter_mut().enumerate() {
            let kind = match i {
                0 => Kind::LowShelf,
                9 => Kind::HighShelf,
                _ => Kind::Peaking,
            };
            band.design(kind, EQ_FREQS[i], gains[i], rate);
        }
        let max_boost = gains.iter().cloned().fold(0.0f32, f32::max);
        self.preamp = db_to_lin(-max_boost);
    }

    /// Обработать буфер на месте. `channels` — сколько каналов чередуется.
    pub fn process(&mut self, buf: &mut [f32], channels: usize, rate: f32) {
        let attack = (-1.0 / (LIMITER_ATTACK_S * rate)).exp();
        let release = (-1.0 / (LIMITER_RELEASE_S * rate)).exp();
        let channels = channels.max(1);

        for (i, sample) in buf.iter_mut().enumerate() {
            // Состояние фильтра своё на канал, иначе стерео смешалось бы.
            let ch = (i % channels).min(1);
            let mut x = *sample;
            if self.enabled {
                x *= self.preamp;
                for band in self.bands.iter_mut() {
                    x = band.process(x, ch);
                }
            }

            // Лимитер: страховка от клиппинга при бусте EQ и нормализации.
            // Не true-peak (нет lookahead), но явный клип ловит — как и
            // DynamicsCompressor, который стоял здесь раньше.
            let level_db = 20.0 * x.abs().max(1e-6).log10();
            let coeff = if level_db > self.env_db { attack } else { release };
            self.env_db = level_db + coeff * (self.env_db - level_db);
            if self.env_db > LIMITER_THRESHOLD_DB {
                let over = self.env_db - LIMITER_THRESHOLD_DB;
                let reduction = over * (1.0 - 1.0 / LIMITER_RATIO);
                x *= db_to_lin(-reduction);
            }
            *sample = x;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Нулевые полосы обязаны оставлять сигнал почти нетронутым: иначе
    /// «эквалайзер включён, но всё по нулям» звучало бы не так, как выключен.
    #[test]
    fn flat_eq_is_transparent() {
        let mut dsp = Dsp::new(48000.0);
        dsp.set_bands(true, &[0.0; 10], 48000.0);
        let mut buf = vec![0.1, -0.1, 0.2, -0.2, 0.05, -0.05];
        let before = buf.clone();
        dsp.process(&mut buf, 2, 48000.0);
        for (got, want) in buf.iter().zip(before.iter()) {
            assert!((got - want).abs() < 0.02, "получили {got}, ждали около {want}");
        }
    }

    /// Буст полосы не должен выбрасывать сигнал за единицу — за этим следят
    /// авто-преамп и лимитер вместе.
    #[test]
    fn boost_does_not_clip() {
        let mut dsp = Dsp::new(48000.0);
        let mut gains = [0.0f32; 10];
        gains[4] = 12.0;
        dsp.set_bands(true, &gains, 48000.0);
        let mut buf: Vec<f32> = (0..4800)
            .map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 500.0 / 48000.0).sin() * 0.9)
            .collect();
        dsp.process(&mut buf, 1, 48000.0);
        let peak = buf.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak <= 1.0, "пик {peak} вышел за единицу");
    }
}
