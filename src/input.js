// Single-line text field. Our own instead of ink-text-input, so shortcuts
// (Ctrl+N, Alt+↑…) don't end up typed into the message.
import React, { useState } from 'react';
import { Text, useInput } from 'ink';

const h = React.createElement;

export function LineInput({ value, onChange, onSubmit, focus, placeholder }) {
  const [cursor, setCursor] = useState(value.length);
  const pos = Math.min(cursor, value.length);

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit(value);
        setCursor(0);
        return;
      }
      if (key.leftArrow) return setCursor(Math.max(0, pos - 1));
      if (key.rightArrow) return setCursor(Math.min(value.length, pos + 1));
      if (key.home || (key.ctrl && input === 'a')) return setCursor(0);
      if (key.end || (key.ctrl && input === 'e')) return setCursor(value.length);
      if (key.backspace || key.delete) {
        if (pos === 0) return;
        onChange(value.slice(0, pos - 1) + value.slice(pos));
        return setCursor(pos - 1);
      }
      // Ctrl+W: delete the previous word
      if (key.ctrl && input === 'w') {
        const before = value.slice(0, pos).replace(/\S+\s*$/, '');
        onChange(before + value.slice(pos));
        return setCursor(before.length);
      }
      if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return;
      if (!input) return;
      const clean = input.replace(/[\r\n]+/g, ' ');
      onChange(value.slice(0, pos) + clean + value.slice(pos));
      setCursor(pos + clean.length);
    },
    { isActive: focus },
  );

  if (!value && placeholder) {
    return h(Text, null, focus ? h(Text, { inverse: true }, placeholder[0]) : placeholder[0], h(Text, { dimColor: true }, placeholder.slice(1)));
  }
  if (!focus) return h(Text, { dimColor: true }, value);
  const at = value[pos] ?? ' ';
  return h(Text, null, value.slice(0, pos), h(Text, { inverse: true }, at), value.slice(pos + 1));
}
