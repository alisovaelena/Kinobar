'use strict';
// Shared helpers for screen.js and admin.js.

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatPrice(value, currency) {
  const n = Number(value);
  const text = Number.isInteger(n) ? n.toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${text} ${currency}` : text;
}
