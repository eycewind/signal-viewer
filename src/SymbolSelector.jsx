import { useEffect, useMemo, useState } from "react";

const MAX_SUGGESTIONS = 12;

export default function SymbolSelector({
  symbols,
  value,
  onValueChange,
  onConfirm,
  loading,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const suggestions = useMemo(() => {
    const query = value.trim().toUpperCase();
    if (!query) return symbols.slice(0, MAX_SUGGESTIONS);

    const prefix = [];
    const substring = [];
    symbols.forEach(symbol => {
      if (symbol.startsWith(query)) prefix.push(symbol);
      else if (symbol.includes(query)) substring.push(symbol);
    });
    return prefix.concat(substring).slice(0, MAX_SUGGESTIONS);
  }, [symbols, value]);

  useEffect(() => {
    setHighlighted(-1);
  }, [value]);

  const choose = symbol => {
    onValueChange(symbol);
    onConfirm(symbol);
    setOpen(false);
    setHighlighted(-1);
  };

  const submit = () => {
    if (highlighted >= 0 && suggestions[highlighted]) {
      choose(suggestions[highlighted]);
      return;
    }
    onConfirm(value.trim().toUpperCase());
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", width: 190, textAlign: "left" }}>
      <label htmlFor="symbol-search" style={{ display: "block", fontSize: 10, marginBottom: 3 }}>
        Search symbol
      </label>
      <div style={{ display: "flex", gap: 5 }}>
        <input
          id="symbol-search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="symbol-suggestions"
          aria-activedescendant={highlighted >= 0 ? `symbol-option-${highlighted}` : undefined}
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={loading ? "Loading symbols…" : "Ticker"}
          onChange={event => {
            onValueChange(event.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setHighlighted(current => Math.min(current + 1, suggestions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setHighlighted(current => current <= 0 ? suggestions.length - 1 : current - 1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              setOpen(false);
              setHighlighted(-1);
            }
          }}
          style={{
            minWidth: 0,
            width: 130,
            boxSizing: "border-box",
            background: "#151a22",
            color: "#d6dde8",
            border: "1px solid #3a4457",
            borderRadius: 6,
            padding: "5px 8px",
            fontSize: 12,
            textTransform: "uppercase",
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || loading}
          style={{
            background: "#233043",
            color: "#d6dde8",
            border: "1px solid #3a4457",
            borderRadius: 6,
            padding: "4px 8px",
            cursor: disabled ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          Load
        </button>
      </div>
      {open && !disabled && suggestions.length > 0 && (
        <ul
          id="symbol-suggestions"
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "100%",
            left: 0,
            right: 0,
            listStyle: "none",
            margin: 4,
            padding: 3,
            maxHeight: 230,
            overflowY: "auto",
            background: "#151a22",
            border: "1px solid #3a4457",
            borderRadius: 6,
            boxShadow: "0 8px 24px #000a",
          }}
        >
          {suggestions.map((symbol, index) => (
            <li
              id={`symbol-option-${index}`}
              role="option"
              aria-selected={index === highlighted}
              key={symbol}
              onMouseDown={event => {
                event.preventDefault();
                choose(symbol);
              }}
              onMouseEnter={() => setHighlighted(index)}
              style={{
                color: index === highlighted ? "#fff" : "#d6dde8",
                background: index === highlighted ? "#233043" : "transparent",
                borderRadius: 4,
                padding: "4px 7px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {symbol}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
