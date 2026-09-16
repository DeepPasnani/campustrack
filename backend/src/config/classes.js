// Only these class clusters / years are eligible to use this placement
// platform. Every class row, student assignment and targeting control is
// restricted to this list — the single source of truth that the seed
// script, backend validation and the /api/meta/options endpoint all share.
const ALLOWED_CLASSES = ['Class 1', 'Class 2', 'Class 3', 'Class 4'];

const ALLOWED_YEARS = [1, 2, 3, 4];

const ALLOWED_CLASS_SET = new Set(ALLOWED_CLASSES);

const ALLOWED_YEAR_SET = new Set(ALLOWED_YEARS);

function isAllowedClass(value) {
  return typeof value === 'string' && ALLOWED_CLASS_SET.has(value.trim());
}

function isAllowedYear(value) {
  const num = Number(value);
  return Number.isInteger(num) && ALLOWED_YEAR_SET.has(num);
}

module.exports = {
  ALLOWED_CLASSES,
  ALLOWED_YEARS,
  ALLOWED_CLASS_SET,
  ALLOWED_YEAR_SET,
  isAllowedClass,
  isAllowedYear,
};
