# Taskify API

Backend for Taskify, a task management platform for personal productivity and team collaboration. One NestJS API serves both the web app and the mobile app.

Every user has a **Personal workspace** and can join any number of **organization workspaces**, with a different role in each one. Projects, tasks, comments, files, notifications, search and the dashboard all live inside a workspace and are only visible to its members.

## Stack

| Part | Technology |
| --- | --- |
| Framework | NestJS 8 (TypeScript) |
| Database | MongoDB with Mongoose 6 |
| Auth | JWT access + refresh tokens, bcrypt, email OTP (Resend) |
| Realtime | Socket.IO |
| Background jobs | `@nestjs/schedule` (due-date reminders) |
| AI | Claude via the Anthropic SDK (optional) |
| Docs | Swagger at `/api` |
| Tests | Jest + Supertest against an in-memory MongoDB |

## Quick start

```bash
pnpm install
cp .env.example .env      # then fill in MONGO_URI and JWT_SECRET
pnpm migrate              # only needed once for a database with pre-workspace data
pnpm start:dev
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api`
- Health: `http://localhost:3000/health`

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Signs access and refresh tokens |
| `PORT` | No | Defaults to 3000 |
| `RESEND_API_KEY`, `EMAIL_FROM` | For email | OTP, password reset and invitation emails |
| `APP_URL` | No | Web app URL used in invitation emails |
| `CORS_ORIGINS` | No | Comma-separated allowed origins; empty allows the request origin |
| `UPLOAD_DIR` | No | Where avatars and attachments are stored; defaults to `./uploads` |
| `ANTHROPIC_API_KEY` | For AI | Enables the AI task breakdown; without it those endpoints return 503 |

The app refuses to start if `MONGO_URI` or `JWT_SECRET` is missing.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm start:dev` | Run with hot reload |
| `pnpm build` / `pnpm start:prod` | Build to `dist/` and run it |
| `pnpm lint` | ESLint + Prettier (auto-fix) |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | End-to-end tests; starts its own in-memory MongoDB, no setup needed |
| `pnpm migrate` / `pnpm migrate:prod` | Run pending data migrations (dev / built) |

## Project structure

```text
src/
├── main.ts, app.setup.ts     bootstrap, validation pipe, error filter, Swagger
├── app.module.ts             wires every module, global guards, throttling
├── common/                   permissions, guards, decorators, events, pagination, email, utils
├── database/                 Mongo connection and migrations
├── auth/  users/             registration, login, tokens, profile
├── workspaces/               workspaces, members, roles, workspace access checks
├── invitations/              invite by email, accept / decline / cancel
├── projects/                 projects, project members, project access checks
├── labels/                   workspace labels
├── tasks/                    tasks, subtasks, My Tasks, task access checks
├── task-dependencies/        "A blocks B" links
├── comments/  attachments/   collaboration on a task
├── activity/  notifications/ audit log, in-app notifications, reminders
├── search/  dashboard/       read-only, access-scoped queries
├── realtime/                 Socket.IO gateway
├── ai/                       AI task breakdown
└── health/                   health and readiness probes
test/                         end-to-end suites and the test app harness
```

## How access works

- Roles belong to the workspace membership, not the user: **OWNER > ADMIN > MANAGER > MEMBER > VIEWER**.
- Each role maps to permissions such as `task:update` or `member:invite` in `src/common/authorization/permissions.ts`. Code checks permissions, never role names.
- Every id sent by a client is resolved on the server: task → project → workspace → your membership → permission.
- Not a member, or the project isn't visible to you → **404**. A member without the permission → **403**.
- Members and viewers see only the projects they were added to; managers and above see every project in the workspace.

## API at a glance

| Area | Main routes |
| --- | --- |
| Auth | `/auth/register`, `/login`, `/refresh`, `/logout`, `/verify-email`, `/forgot-password`, `/reset-password`, `/change-password`, `/profile` |
| Users | `GET /users/me`, `POST /users/me/avatar`, `GET /users/me/tasks` (My Tasks) |
| Workspaces | `/workspaces`, `/workspaces/:id/members` |
| Invitations | `/workspaces/:id/invitations`, `/invitations`, `/invitations/:id/accept` |
| Projects | `/workspaces/:id/projects`, `/projects/:id`, `/projects/:id/members` |
| Tasks | `/projects/:id/tasks`, `/tasks/:id`, `/tasks/:id/subtasks`, `/tasks/:id/dependencies` |
| Collaboration | `/workspaces/:id/labels`, `/tasks/:id/comments`, `/tasks/:id/attachments` |
| Feeds | `/notifications`, `/workspaces/:id/activity`, `/tasks/:id/activity` |
| Insights | `/search`, `/workspaces/:id/dashboard` |
| AI | `/projects/:id/ai/task-breakdown` |
| Realtime | Socket.IO namespace `/realtime` |

Lists accept `page` and `limit` (max 100) and return `{ items, meta: { page, limit, total, totalPages } }`. Errors return `{ success: false, statusCode, error, message, path, timestamp }`. Full request and response schemas are in Swagger.

## More documentation

- `ARCHITECTURE.md`: request flow, events, data model and conventions for adding features.
- `README-architecture.md`: guards, decorators and pipes, plus feature status against the original specification.
- `src/health/HEALTH_MODULE_README.md`: health endpoints.
