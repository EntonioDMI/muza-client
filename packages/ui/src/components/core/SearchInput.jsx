import React from "react";
import { Icon } from "./Icon.jsx";

/** Search field — pill, surface step on hover, accent ring on focus.
 *
 *  ⚠️ БЕЗ СОСТОЯНИЯ REACT (13.08.2026). Здесь стояли два useState — hover и
 *  focus, — и вид поля собирался тремя тернарниками. Заменено каналом
 *  .muza-field (interactions.css): там же разбор, почему фокус теперь говорит
 *  акцентным кольцом, а не четвёртой плёнкой (четвёртая — это «выделено», и
 *  сфокусированное поле ею притворяться не должно).
 *
 *  ⚠️ ИКОНКА БЕЗ ЯВНОГО color — И ЭТО НУЖНО. Она наследует currentColor
 *  оболочки, а его красит канал (--field-fg): подпись, иконка и заливка
 *  оживают одним движением. Прибей сюда цвет — и иконка останется тусклой,
 *  когда всё остальное поле уже подсветилось.
 *
 *  ⚠️ У <input> outline снят намеренно: кольцо фокуса рисует ОБОЛОЧКА через
 *  :focus-within. Иначе акцент обвёл бы текстовую строку внутри плашки, а
 *  человек считает полем всю плашку целиком. */
export function SearchInput({ value, onChange, placeholder = "Search", icon = "search", autoFocus = false, style }) {
  return (
    <label
      className="muza-field"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--sp-3)",
        height: 44,
        /* 20, а не 16: при высоте 44 пилюля скругляется на 22, и на высоте
           иконки левый край плашки уже ушёл вправо от её геометрической
           границы. С полем 16 иконка визуально сидела В ИЗГИБЕ, а не за ним
           (видно на снимке двух вариантов строка под строкой). Значение живёт
           отступом контейнера, а не сдвигом иконки: правый край поля должен
           отбиваться так же, когда там появится второй элемент. */
        padding: "0 var(--sp-5)",
        /* «скругление по типам»: поле поиска — поле; дефолт — пилюля */
        borderRadius: "var(--r-field, var(--r-pill))",
        background: "var(--field-bg)",
        color: "var(--field-fg)",
        cursor: "text",
        transition: "background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)",
        ...style,
      }}
    >
      <Icon name={icon} size={18} />
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-1)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--fs-body)",
        }}
      />
    </label>
  );
}
