/* Демо-каталог Stage 1 (вымышленные артисты и оригинальные строки — из ui_kits/muza-app).
   Заменяется реальным каталогом с сервера в Stage 2. */

import cover1 from "../assets/covers/cover-1.png";
import cover2 from "../assets/covers/cover-2.png";
import cover3 from "../assets/covers/cover-3.png";
import cover4 from "../assets/covers/cover-4.png";
import cover5 from "../assets/covers/cover-5.png";
import cover6 from "../assets/covers/cover-6.png";
import cover7 from "../assets/covers/cover-7.png";
import cover8 from "../assets/covers/cover-8.png";

export interface LyricLine {
  t: number;
  text: string;
  /** Объяснение смысла строки («режим смысла», Genius-аннотации Stage 5).
   *  Пока демо-контент — строки с note подчёркнуты пунктиром, клик открывает карточку. */
  note?: string;
}

export interface DemoTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover: string;
  explicit: boolean;
  lyrics: LyricLine[];
}

export interface DemoCollection {
  id: string;
  name: string;
  meta: string;
  cover: string;
}

export const COVERS = [cover1, cover2, cover3, cover4, cover5, cover6, cover7, cover8];

export const TRACKS: DemoTrack[] = [
  {
    id: "t1",
    title: "Кометы над городом",
    artist: "Северный ветер",
    album: "Полночь",
    duration: 212,
    cover: cover1,
    explicit: false,
    lyrics: [
      { t: 0, text: "Город засыпает, я включаю свет" },
      { t: 9, text: "На кухне остывает старый чёрный плед" },
      { t: 18, text: "Ты мне пишешь: «выйди, посмотри наверх»" },
      { t: 27, text: "Кометы над городом — на всех" },
      { t: 36, text: "" },
      { t: 44, text: "Мы стоим на крыше, ловим этот свет" },
      { t: 53, text: "Никакой цензуры, никаких помех" },
      { t: 62, text: "Пусть соседи злятся — нам плевать на всех" },
      { t: 71, text: "Кометы над городом — на всех" },
      { t: 80, text: "" },
      { t: 92, text: "Если станет тихо — просто подпевай" },
      { t: 101, text: "Слово в слово, честно, ничего не прячь" },
      { t: 110, text: "Эта ночь запишет нас в свой плейлист" },
      { t: 119, text: "И оставит строчку: «повторись»" },
      { t: 132, text: "" },
      { t: 150, text: "Кометы над городом — на всех" },
      { t: 168, text: "Кометы над городом — на всех" },
    ],
  },
  {
    id: "t2",
    title: "Не глуши мотор",
    artist: "Пламя",
    album: "Сингл",
    duration: 187,
    cover: cover2,
    explicit: true,
    lyrics: [
      { t: 0, text: "Три часа ночи, город пуст, как чёрт" },
      { t: 8, text: "Ты сказала: «едем», я сказал: «а то»" },
      { t: 16, text: "Фонари мигают в такт на сто шестьдесят" },
      { t: 24, text: "Не глуши мотор, не тормози назад" },
      { t: 33, text: "" },
      { t: 41, text: "Весь этот текст — как есть, без звёзд и точек" },
      { t: 49, text: "Муза не боится неудобных строчек" },
      { t: 57, text: "Кто-то заблюрит — мы споём дословно" },
      { t: 65, text: "Громко, неровно, зато свободно" },
      { t: 76, text: "" },
      { t: 90, text: "Не глуши мотор — пусть орёт шансон" },
      { t: 98, text: "Этот трек про нас, остальное — сон" },
      { t: 110, text: "Не глуши мотор, не глуши мотор" },
      { t: 126, text: "Довези меня до самых гор" },
    ],
  },
  {
    id: "t3",
    title: "Стеклянный дом",
    artist: "Мира",
    album: "Тише",
    duration: 234,
    cover: cover3,
    explicit: false,
    lyrics: [
      {
        t: 0,
        text: "В стеклянном доме не бросают слов",
        note: "Переиначенная пословица «живущий в стеклянном доме не бросает камни» — камни здесь заменены словами. В отношениях, где всё на виду, любое неосторожное слово бьёт как камень по стеклу.",
      },
      { t: 10, text: "Здесь каждый шёпот слышен сквозь стекло" },
      { t: 20, text: "Я растворяюсь в матовом окне" },
      { t: 30, text: "И город медленно плывёт ко мне" },
      { t: 42, text: "" },
      { t: 52, text: "Тише, тише — не буди рассвет" },
      { t: 62, text: "Пусть эта ночь оставит мягкий след" },
      {
        t: 72,
        text: "Стеклянный дом, а в нём — одни огни",
        note: "Образ открытости, в которой нет близости: снаружи стеклянного дома видно только свет, но не людей. Огни без силуэтов — присутствие без прикосновения.",
      },
      { t: 82, text: "Останься до восьми" },
      { t: 96, text: "" },
      { t: 116, text: "Тише, тише — не буди рассвет" },
      {
        t: 136,
        text: "Стеклянный дом хранит наш силуэт",
        note: "Финал переворачивает образ: стекло, которое всю песню делало героев уязвимыми, становится памятью — единственным свидетелем, что здесь были двое. Хрупкость превращается в способ сохранить.",
      },
    ],
  },
  {
    id: "t4",
    title: "Один процент",
    artist: "ОКТАВА",
    album: "Ре-минор",
    duration: 198,
    cover: cover4,
    explicit: true,
    lyrics: [
      { t: 0, text: "Мне говорили: шансов — один процент" },
      { t: 9, text: "Я взял этот процент и сделал из него момент" },
      { t: 18, text: "Пусть говорят, что дерзко, — да, в самый цвет" },
      { t: 27, text: "Здесь не глушат слова, здесь читают текст" },
      { t: 38, text: "" },
      { t: 50, text: "Один процент — и весь зал поёт" },
      { t: 59, text: "Один процент — и никто не врёт" },
      { t: 70, text: "Сцена, свет, микрофон и бит" },
      { t: 79, text: "Каждое слово — как есть звучит" },
    ],
  },
];

export const PLAYLISTS: DemoCollection[] = [
  { id: "p1", name: "Ночной вайб", meta: "42 трека", cover: cover5 },
  { id: "p2", name: "Для дороги", meta: "28 треков", cover: cover6 },
  { id: "p3", name: "Любимое", meta: "117 треков", cover: cover7 },
];

export const RELEASES: DemoCollection[] = [
  { id: "r1", name: "Полночь", meta: "Северный ветер", cover: cover1 },
  { id: "r2", name: "Ре-минор", meta: "ОКТАВА", cover: cover4 },
  { id: "r3", name: "Тише", meta: "Мира", cover: cover3 },
  { id: "r4", name: "Сингл", meta: "Пламя", cover: cover2 },
  { id: "r5", name: "Эхо", meta: "Собрано для тебя", cover: cover8 },
];

export const NEW_PLAYLIST_COVER = cover8;
