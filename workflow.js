export function substitute(template, values) {
  return template.replace(/\{\{(input|context|style|text)\}\}/g, (_, key) => values[key] || '');
}
export function transformText(text, mode) {
  if (mode === 'trim') return text.split('\n').map(line => line.trim()).join('\n').trim();
  if (mode === 'bullets') return text.split(/\n+/).filter(line => line.trim()).map(line => '• ' + line.replace(/^\s*[•*-]\s*/, '').trim()).join('\n');
  if (mode === 'uppercase') return text.toUpperCase();
  return text;
}
export function checkText(text, minimum, required = '') {
  const words = required.split(',').map(word => word.trim()).filter(Boolean);
  const missing = words.filter(word => !text.toLocaleLowerCase().includes(word.toLocaleLowerCase()));
  const min = Number(minimum);
  if (!Number.isFinite(min) || min < 0 || min > 50000) throw new Error('Minimum length must be between 0 and 50,000.');
  return {passed: text.trim().length >= min && !missing.length, message: `${text.trim().length} characters; minimum ${min}.${missing.length ? ' Missing: ' + missing.join(', ') : ' Required text present.'}`};
}
export const defaultNodes = () => [
  {id:crypto.randomUUID(),type:'context',title:'Gather connected references'},
  {id:crypto.randomUUID(),type:'template',title:'Assemble the prompt',template:'Task:\n{{input}}\n\nReference material:\n{{context}}\n\nDesign direction:\n{{style}}\n\nGive a clear, practical response. State any assumptions.'},
  {id:crypto.randomUUID(),type:'quality',title:'Check completeness',minimum:40,required:''}
];
