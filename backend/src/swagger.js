const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CampusTrack API',
      version: '1.0.0',
      description: 'Mock Placement Assessment Platform API',
      contact: {
        name: 'CampusTrack Team',
        email: 'support@campustrack.edu',
      },
    },
    servers: [
      { url: '/api', description: 'API server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['student', 'admin', 'super_admin'] },
            department: { type: 'string' },
            branch: { type: 'string' },
            roll_number: { type: 'string' },
            class_name: { type: 'string' },
            year_of_study: { type: 'integer' },
            is_active: { type: 'boolean' },
            avatar_url: { type: 'string' },
            last_login: { type: 'string', format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Test: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'published', 'archived'] },
            department: { type: 'string' },
            duration_minutes: { type: 'integer' },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            settings: { type: 'object' },
            created_by: { type: 'string', format: 'uuid' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Submission: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            test_id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['in_progress', 'submitted', 'auto_submitted'] },
            score: { type: 'number' },
            max_score: { type: 'number' },
            answers: { type: 'object' },
            code_solutions: { type: 'object' },
            code_results: { type: 'object' },
            started_at: { type: 'string', format: 'date-time' },
            submitted_at: { type: 'string', format: 'date-time' },
            time_taken_seconds: { type: 'integer' },
            tab_switch_count: { type: 'integer' },
            selected_problems: { type: 'array', items: { type: 'string' } },
          },
        },
        Drive: {
          type: 'object',
          description: 'A plain grouping of existing Tests for combined analytics/viewing — no schedule, duration or passing score of its own.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            test_count: { type: 'integer' },
          },
        },
        Class: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            department: { type: 'string' },
            year_of_study: { type: 'integer' },
            is_active: { type: 'boolean' },
          },
        },
        Question: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['mcq', 'msq'] },
            text: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            marks: { type: 'integer' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            genre: { type: 'string' },
            explanation: { type: 'string' },
          },
        },
        CodingProblem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            input_format: { type: 'string' },
            output_format: { type: 'string' },
            constraints: { type: 'string' },
            sample_input: { type: 'string' },
            sample_output: { type: 'string' },
            marks: { type: 'integer' },
            difficulty: { type: 'string' },
            tags: { type: 'string' },
          },
        },
      },
    },
    paths: {
      // ── Auth ──────────────────────────────────────────────────
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login with email and password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', format: 'password' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      user: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new student account',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'password'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', format: 'password', minLength: 8 },
                    department: { type: 'string' },
                    rollNumber: { type: 'string' },
                    branch: { type: 'string' },
                    class_name: { type: 'string' },
                    yearOfStudy: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Account created' },
            400: { description: 'Validation error' },
          },
        },
      },
      '/auth/google': {
        post: {
          tags: ['Auth'],
          summary: 'Login/Register with Google OAuth',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['credential'],
                  properties: {
                    credential: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Google login successful' },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Logout current user',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Logged out' },
          },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user profile',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Current user data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      user: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/auth/change-password': {
        post: {
          tags: ['Auth'],
          summary: 'Change password',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['currentPassword', 'newPassword'],
                  properties: {
                    currentPassword: { type: 'string' },
                    newPassword: { type: 'string', minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Password changed' },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request password reset OTP',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string', format: 'email' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'OTP sent if email exists' },
          },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Reset password with OTP',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'otp', 'newPassword'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    otp: { type: 'string' },
                    newPassword: { type: 'string', minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Password reset successful' },
          },
        },
      },

      // ── Tests ─────────────────────────────────────────────────
      '/tests': {
        get: {
          tags: ['Tests'],
          summary: 'List tests (role-dependent)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'List of tests',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tests: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Test' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Tests'],
          summary: 'Create a new test',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'department'],
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    department: { type: 'string' },
                    durationMinutes: { type: 'integer' },
                    startTime: { type: 'string', format: 'date-time' },
                    endTime: { type: 'string', format: 'date-time' },
                    settings: { type: 'object' },
                    sections: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          type: { type: 'string', enum: ['aptitude', 'coding'] },
                          questions: { type: 'array' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Test created' },
          },
        },
      },
      '/tests/{id}': {
        get: {
          tags: ['Tests'],
          summary: 'Get test with sections and questions',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Test details',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Test' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Tests'],
          summary: 'Update test',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Test updated' },
          },
        },
        delete: {
          tags: ['Tests'],
          summary: 'Delete test',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Test deleted' },
          },
        },
      },
      '/tests/{id}/duplicate': {
        post: {
          tags: ['Tests'],
          summary: 'Duplicate a test',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            201: { description: 'Test duplicated' },
          },
        },
      },
      '/tests/{id}/classes': {
        get: {
          tags: ['Tests'],
          summary: 'Get classes mapped to test',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Classes' },
          },
        },
        post: {
          tags: ['Tests'],
          summary: 'Map classes to test',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Class mapping updated' },
          },
        },
      },

      // ── Submissions ───────────────────────────────────────────
      '/submissions/start': {
        post: {
          tags: ['Submissions'],
          summary: 'Start a test attempt',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['testId'],
                  properties: { testId: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Test started',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      submission: { $ref: '#/components/schemas/Submission' },
                      remainingSeconds: { type: 'integer' },
                      activeUsers: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/submissions/save': {
        post: {
          tags: ['Submissions'],
          summary: 'Auto-save answers during test',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Answers saved' },
          },
        },
      },
      '/submissions/submit': {
        post: {
          tags: ['Submissions'],
          summary: 'Submit test',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Test submitted with score',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      submission: { $ref: '#/components/schemas/Submission' },
                      score: { type: 'number' },
                      maxScore: { type: 'number' },
                      percentage: { type: 'number' },
                      passed: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/submissions/run-code': {
        post: {
          tags: ['Submissions'],
          summary: 'Run code against test cases',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code', 'language'],
                  properties: {
                    code: { type: 'string' },
                    language: { type: 'string', enum: ['python', 'javascript', 'java', 'cpp', 'c'] },
                    stdin: { type: 'string' },
                    testCases: { type: 'array' },
                    timeLimit: { type: 'integer' },
                    memoryLimit: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Code execution results' },
          },
        },
      },
      '/submissions/my': {
        get: {
          tags: ['Submissions'],
          summary: 'Get my submissions',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'User submissions',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      submissions: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Submission' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/submissions/test/{testId}': {
        get: {
          tags: ['Submissions'],
          summary: 'Get submissions for a test (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'testId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Test submissions',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      submissions: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Submission' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/submissions/test/{testId}/export-csv': {
        get: {
          tags: ['Submissions'],
          summary: 'Export results as CSV',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'testId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'class', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'CSV file' },
          },
        },
      },
      '/submissions/test/{testId}/export-pdf': {
        get: {
          tags: ['Submissions'],
          summary: 'Export results as PDF',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'testId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'PDF report' },
          },
        },
      },
      '/submissions/resume/{id}': {
        post: {
          tags: ['Submissions'],
          summary: 'Resume an auto-submitted test (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Test resumed' },
          },
        },
      },
      '/submissions/{id}': {
        get: {
          tags: ['Submissions'],
          summary: 'Get submission details',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Submission details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      submission: { $ref: '#/components/schemas/Submission' },
                    },
                  },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Submissions'],
          summary: 'Delete a submission (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Submission deleted' },
          },
        },
      },
      '/submissions/question-analytics': {
        get: {
          tags: ['Submissions'],
          summary: 'Question difficulty analytics',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Question analytics' },
          },
        },
      },
      '/submissions/plagiarism-check/{testId}': {
        get: {
          tags: ['Submissions'],
          summary: 'Check code plagiarism',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'testId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'threshold', in: 'query', schema: { type: 'number' } },
          ],
          responses: {
            200: { description: 'Plagiarism report' },
          },
        },
      },

      // ── Users ─────────────────────────────────────────────────
      '/users': {
        get: {
          tags: ['Users'],
          summary: 'List users (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'role', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            200: {
              description: 'List of users',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/stats': {
        get: {
          tags: ['Users'],
          summary: 'Get aggregate user statistics',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'User stats' },
          },
        },
      },
      '/users/admin': {
        post: {
          tags: ['Users'],
          summary: 'Create admin user (super_admin only)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string', format: 'email' } },
                },
              },
            },
          },
          responses: {
            201: { description: 'Admin created' },
          },
        },
      },
      '/users/bulk-import': {
        post: {
          tags: ['Users'],
          summary: 'Bulk import students (admin)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Students imported' },
          },
        },
      },
      '/users/{id}': {
        patch: {
          tags: ['Users'],
          summary: 'Update user (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'User updated' },
          },
        },
        delete: {
          tags: ['Users'],
          summary: 'Delete user (super_admin only)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'User deleted' },
          },
        },
      },
      '/users/{id}/analytics': {
        get: {
          tags: ['Users'],
          summary: 'Get student analytics (admin)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Student analytics' },
          },
        },
      },
      '/admins': {
        get: {
          tags: ['Users'],
          summary: 'List admin users (super_admin only)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Admin list' },
          },
        },
      },

      // ── Question Bank ─────────────────────────────────────────
      '/question-bank': {
        get: {
          tags: ['Question Bank'],
          summary: 'List question bank',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Question bank items' },
          },
        },
        post: {
          tags: ['Question Bank'],
          summary: 'Create question bank item',
          security: [{ bearerAuth: [] }],
          responses: {
            201: { description: 'Question created' },
          },
        },
      },
      '/question-bank/import': {
        post: {
          tags: ['Question Bank'],
          summary: 'Bulk import questions',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Questions imported' },
          },
        },
      },
      '/question-bank/import-csv': {
        post: {
          tags: ['Question Bank'],
          summary: 'Import questions from CSV',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'CSV imported' },
          },
        },
      },
      '/question-bank/import-json': {
        post: {
          tags: ['Question Bank'],
          summary: 'Import questions from JSON',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'JSON imported' },
          },
        },
      },
      '/question-bank/{id}': {
        delete: {
          tags: ['Question Bank'],
          summary: 'Delete question bank item',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Question deleted' },
          },
        },
      },

      // ── Drives ────────────────────────────────────────────────
      '/drives': {
        get: {
          tags: ['Drives'],
          summary: 'List drives',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'List of drives',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      drives: { type: 'array', items: { $ref: '#/components/schemas/Drive' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Drives'],
          summary: 'Create a drive',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    testIds: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Tests to attach immediately' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Drive created' },
          },
        },
      },
      '/drives/{id}': {
        get: {
          tags: ['Drives'],
          summary: 'Get drive details',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Drive details',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Drive' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Drives'],
          summary: 'Update drive',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Drive updated' },
          },
        },
        delete: {
          tags: ['Drives'],
          summary: 'Delete drive',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Drive deleted' },
          },
        },
      },
      '/drives/{id}/tests': {
        post: {
          tags: ['Drives'],
          summary: 'Add test to drive',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Test added' },
          },
        },
      },
      '/drives/{id}/tests/{testId}': {
        delete: {
          tags: ['Drives'],
          summary: 'Remove test from drive',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'testId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Test removed' },
          },
        },
      },
      '/drives/{id}/stats': {
        get: {
          tags: ['Drives'],
          summary: 'Get drive statistics',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Drive stats' },
          },
        },
      },

      // ── Classes ───────────────────────────────────────────────
      '/classes': {
        get: {
          tags: ['Classes'],
          summary: 'List classes',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'List of classes',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      classes: { type: 'array', items: { $ref: '#/components/schemas/Class' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Classes'],
          summary: 'Create class',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'department'],
                  properties: {
                    name: { type: 'string' },
                    department: { type: 'string' },
                    year_of_study: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Class created' },
          },
        },
      },
      '/classes/{id}': {
        delete: {
          tags: ['Classes'],
          summary: 'Delete class',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Class deleted' },
          },
        },
      },
      '/classes/assign': {
        post: {
          tags: ['Classes'],
          summary: 'Assign students to class',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Students assigned' },
          },
        },
      },

      // ── Email ─────────────────────────────────────────────────
      '/email/send': {
        post: {
          tags: ['Email'],
          summary: 'Send bulk email (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['recipients', 'subject', 'body'],
                  properties: {
                    recipients: {
                      type: 'array',
                      items: { type: 'string', format: 'email' },
                    },
                    subject: { type: 'string' },
                    body: { type: 'string' },
                    template: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Email sent' },
          },
        },
      },

      // ── Health ────────────────────────────────────────────────
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check endpoint',
          responses: {
            200: {
              description: 'Service health status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      checks: {
                        type: 'object',
                        properties: {
                          database: { type: 'boolean' },
                          redis: { type: 'boolean' },
                        },
                      },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Upload ────────────────────────────────────────────────
      '/upload/image': {
        post: {
          tags: ['Upload'],
          summary: 'Upload image (admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    image: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Image uploaded' },
          },
        },
      },
      '/upload/image/{publicId}': {
        delete: {
          tags: ['Upload'],
          summary: 'Delete uploaded image',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'publicId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Image deleted' },
          },
        },
      },
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
