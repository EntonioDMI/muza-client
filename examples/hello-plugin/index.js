/**
 * hello-plugin — минимальный пример плагина Muza уровня 1 (песочница).
 *
 * Этот файл исполняется ВНУТРИ iframe-песочницы (opaque origin, без DOM
 * хоста, без сети в обход Muza.Net) — единственный способ повлиять на
 * приложение отсюда — вызовы window.Muza.* (за правами из manifest.json)
 * и подписка на Muza.Events. См. PLUGINS.md в корне репозитория за полным
 * справочником API.
 *
 * Один и тот же документ используется и как СКРЫТЫЙ фон (пока плагин просто
 * ждёт кликов по кнопке бара/пункту меню), и как содержимое своей вкладки,
 * когда пользователь её открывает — поэтому мы всегда рисуем разметку вкладки
 * сразу, а видимость фрейма (скрыт/вкладка) решает хост, не мы.
 */
(function () {
  "use strict";

  function render() {
    var root = document.createElement("div");
    root.style.cssText = "font-family: sans-serif; min-height: 100vh; margin: 0; padding: 32px; background: #121110; color: #eee; box-sizing: border-box;";

    var h1 = document.createElement("h1");
    h1.textContent = "Hello, Muza!";
    h1.style.cssText = "margin: 0 0 8px;";

    var p = document.createElement("p");
    p.textContent = "Это вкладка плагина hello-plugin — пример уровня 1. Нажми кнопку ниже, чтобы спросить у плеера, что сейчас играет.";
    p.style.cssText = "opacity: .75; line-height: 1.5;";

    var btn = document.createElement("button");
    btn.id = "ask-player";
    btn.textContent = "Что сейчас играет?";
    btn.style.cssText = "font: inherit; padding: 8px 16px; border-radius: 8px; border: none; background: #3b82f6; color: #fff; cursor: pointer;";

    var answer = document.createElement("p");
    answer.id = "answer";
    answer.style.cssText = "opacity: .6; margin-top: 16px;";

    root.appendChild(h1);
    root.appendChild(p);
    root.appendChild(btn);
    root.appendChild(answer);
    document.body.innerHTML = "";
    document.body.appendChild(root);

    btn.addEventListener("click", function () {
      Muza.Player.getCurrentTrack()
        .then(function (track) {
          if (track) {
            answer.textContent = "Сейчас играет: " + track.title + " — " + track.artist;
          } else {
            answer.textContent = "Сейчас ничего не играет.";
          }
        })
        .catch(function () {
          answer.textContent = "Не удалось получить состояние плеера.";
        });
    });
  }

  // Клики по нашим extension points (кнопка бара, пункт меню трека) приходят
  // как событие "slot:click" вне зависимости от того, видна ли сейчас вкладка.
  Muza.Events.on("slot:click", function (data) {
    if (!data || !data.slotId) return;
    if (data.slotId === "greet") {
      Muza.UI.toast("Привет из hello-plugin!", "sparkles");
    } else if (data.slotId === "hello-track" && data.payload) {
      Muza.UI.toast("Привет, «" + data.payload.title + "»!", "sparkles");
    }
  });

  render();
  Muza.UI.toast("hello-plugin загружен", "puzzle");
})();
