const Joi = require('joi');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message).join(', ');
      return res.status(400).json({ error: messages });
    }
    req[source] = value;
    next();
  };
}

const bulkImportSchema = Joi.object({
  students: Joi.array().items(Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    email: Joi.string().email().required(),
    branch: Joi.string().allow('', null).max(100),
    rollNumber: Joi.string().allow('', null).max(50),
  })).min(1).max(5000).required(),
});

const createTestSchema = Joi.object({
  title: Joi.string().trim().min(1).max(300).required(),
  description: Joi.string().allow('', null).max(5000),
  status: Joi.string().valid('draft', 'published', 'archived').default('draft'),
  startTime: Joi.date().iso().allow(null),
  endTime: Joi.date().iso().allow(null),
  durationMinutes: Joi.number().integer().min(1).max(600).required(),
  department: Joi.string().trim().max(200).allow('', null),
  departments: Joi.array().items(Joi.string()).default([]),
  years: Joi.array().items(Joi.any()).default([]),
  classes: Joi.array().items(Joi.string()).default([]),
  settings: Joi.object({
    shuffleQuestions: Joi.boolean(),
    shuffleOptions: Joi.boolean(),
    showResults: Joi.string().valid('after_submit', 'after_end', 'manual', 'never'),
    passingScore: Joi.number().min(0).max(100),
    negativeMarking: Joi.boolean(),
    negativeFraction: Joi.number().min(0).max(1),
    allowedBranches: Joi.string().allow('', null),
    allowedLanguages: Joi.array().items(Joi.string()),
    splitTimers: Joi.boolean(),
    mcqDurationMinutes: Joi.number().integer().min(1).max(300),
    codingDurationMinutes: Joi.number().integer().min(1).max(300),
  }).default(),
  sections: Joi.array().items(Joi.object({
    id: Joi.any(),
    name: Joi.string().max(200),
    type: Joi.string().valid('aptitude', 'coding').required(),
    questions: Joi.array().items(Joi.object()).default([]),
  })).default([]),
});

const submitTestSchema = Joi.object({
  testId: Joi.string().required(),
  answers: Joi.object().pattern(Joi.string(), Joi.any()),
  codeSolutions: Joi.object().pattern(Joi.string(), Joi.object()),
  flaggedQuestions: Joi.array().items(Joi.string()),
  selectedProblems: Joi.array().items(Joi.string()),
  tabSwitchCount: Joi.number().integer().min(0),
  autoSubmitted: Joi.boolean(),
});

const sendEmailSchema = Joi.object({
  subject: Joi.string().trim().min(1).max(500).required(),
  html: Joi.string().min(1).max(100000).required(),
  recipients: Joi.object({
    allStudents: Joi.boolean(),
    departments: Joi.array().items(Joi.string()),
    classes: Joi.array().items(Joi.string()),
    studentIds: Joi.array().items(Joi.string()),
  }).min(1).required(),
});

module.exports = {
  validate,
  bulkImportSchema,
  createTestSchema,
  submitTestSchema,
  sendEmailSchema,
};
