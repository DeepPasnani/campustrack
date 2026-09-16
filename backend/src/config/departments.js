// Only these departments are eligible to use this placement platform.
// Every new/existing student account, test, drive and class is restricted to
// this list.
const ALLOWED_DEPARTMENTS = [
  'Computer Engineering',
  'Computer Science and Design',
  'Aeronautical Engineering',
  'Information Technology',
  'Civil Engineering',
  'Electronics and Communication Engineering',
  'Electrical Engineering',
  'Mechanical Engineering',
];

const ALLOWED_SET = new Set(ALLOWED_DEPARTMENTS);

// Normalise common hand-typed ''/'' spellings to the canonical names above.
const ALIASES = {
  'ce': 'Computer Engineering',
  'cse': 'Computer Engineering',
  'computer': 'Computer Engineering',
  'computerengineering': 'Computer Engineering',
  'computer engineering': 'Computer Engineering',
  'csd': 'Computer Science and Design',
  'csdesign': 'Computer Science and Design',
  'c s d': 'Computer Science and Design',
  'cs design': 'Computer Science and Design',
  'computerscienceanddesign': 'Computer Science and Design',
  'computer science and design': 'Computer Science and Design',
  'aeronautical': 'Aeronautical Engineering',
  'aero': 'Aeronautical Engineering',
  'aeronauticalengineering': 'Aeronautical Engineering',
  'aeronautical engineering': 'Aeronautical Engineering',
  'it': 'Information Technology',
  'informationtechnology': 'Information Technology',
  'information technology': 'Information Technology',
  'civil': 'Civil Engineering',
  'civilengineering': 'Civil Engineering',
  'civil engineering': 'Civil Engineering',
  'ece': 'Electronics and Communication Engineering',
  'electronicsandcommunicationengineering': 'Electronics and Communication Engineering',
  'electronics and communication engineering': 'Electronics and Communication Engineering',
  'electronics': 'Electronics and Communication Engineering',
  'eee': 'Electrical Engineering',
  'electricalengineering': 'Electrical Engineering',
  'electrical engineering': 'Electrical Engineering',
  'electrical': 'Electrical Engineering',
  'me': 'Mechanical Engineering',
  'mechanicalengineering': 'Mechanical Engineering',
  'mechanical engineering': 'Mechanical Engineering',
  'mechanical': 'Mechanical Engineering',
};

function normalizeDepartment(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  const compact = key.replace(/\s+/g, '');
  if (ALIASES[compact]) return ALIASES[compact];
  if (ALIASES[key]) return ALIASES[key];
  return ALLOWED_DEPARTMENTS.find(d => d.toLowerCase() === key) || null;
}

function isAllowedDepartment(value) {
  return Boolean(normalizeDepartment(value));
}

module.exports = {
  ALLOWED_DEPARTMENTS,
  ALLOWED_SET,
  normalizeDepartment,
  isAllowedDepartment,
};
