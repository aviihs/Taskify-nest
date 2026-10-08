import { Types } from 'mongoose';
import { Db, Migration } from './migration';

const STATUS_MAP: Record<string, string> = {
  REVIEW: 'IN_REVIEW',
  TESTING: 'IN_REVIEW',
  COMPLETED: 'DONE',
  CANCELLED: 'DONE',
};

/**
 * Moves pre-workspace data into the workspace model:
 * - every user gets a personal workspace (OWNER membership)
 * - legacy projects move into their owner's personal workspace
 * - legacy tasks without a project go to an "Inbox" project in the creator's personal workspace
 * - legacy task fields/enums/labels are converted; workspace roles are removed from users
 * Idempotent: only documents still in the legacy shape are touched.
 */
export const workspaceModelMigration: Migration = {
  id: '001-workspace-model',
  async up(db: Db) {
    const now = new Date();
    const users = db.collection('users');
    const workspaces = db.collection('workspaces');
    const members = db.collection('workspacemembers');
    const projects = db.collection('projects');
    const projectMembers = db.collection('projectmembers');
    const tasks = db.collection('tasks');
    const labels = db.collection('labels');

    // Platform roles only: workspace roles now live on WorkspaceMember.
    await users.updateMany(
      { role: { $nin: ['ADMIN', 'USER'] } },
      { $set: { role: 'USER' } },
    );

    const personalWorkspaceCache = new Map<string, Types.ObjectId>();
    const personalWorkspace = async (
      owner: Types.ObjectId,
    ): Promise<Types.ObjectId> => {
      const cached = personalWorkspaceCache.get(String(owner));
      if (cached) return cached;
      const ws = await workspaces.findOneAndUpdate(
        { owner, type: 'PERSONAL' },
        {
          $setOnInsert: {
            owner,
            type: 'PERSONAL',
            name: 'Personal',
            description: null,
            avatar: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      const id = ws.value._id as Types.ObjectId;
      await members.updateOne(
        { workspace: id, user: owner },
        {
          $setOnInsert: {
            workspace: id,
            user: owner,
            role: 'OWNER',
            title: null,
            status: 'ACTIVE',
            joinedAt: now,
            invitedBy: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      personalWorkspaceCache.set(String(owner), id);
      return id;
    };
    const addProjectMember = (
      project: Types.ObjectId,
      workspace: Types.ObjectId,
      user: Types.ObjectId,
    ) =>
      projectMembers.updateOne(
        { project, user },
        {
          $setOnInsert: {
            project,
            workspace,
            user,
            addedBy: user,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );

    for await (const user of users.find({}, { projection: { _id: 1 } })) {
      await personalWorkspace(user._id);
    }

    // Legacy projects: { title, owner, members[], deadline, isDeleted }
    for await (const p of projects.find({ workspace: { $exists: false } })) {
      const owner = (p.owner ?? p.createdBy) as Types.ObjectId;
      if (!owner) continue;
      const workspace = await personalWorkspace(owner);
      await projects.updateOne(
        { _id: p._id },
        {
          $set: {
            workspace,
            name: p.title ?? 'Untitled project',
            createdBy: owner,
            dueDate: p.deadline ?? null,
            startDate: null,
            deletedAt: p.isDeleted ? p.updatedAt ?? now : null,
            status: p.status === 'ARCHIVED' ? 'ARCHIVED' : p.status ?? 'ACTIVE',
          },
          $unset: {
            title: '',
            owner: '',
            members: '',
            deadline: '',
            tags: '',
            isDeleted: '',
            isArchived: '',
          },
        },
      );
      await addProjectMember(p._id, workspace, owner);
    }

    const inboxCache = new Map<string, Types.ObjectId>();
    const inbox = async (
      owner: Types.ObjectId,
    ): Promise<{ project: Types.ObjectId; workspace: Types.ObjectId }> => {
      const workspace = await personalWorkspace(owner);
      let project = inboxCache.get(String(owner));
      if (!project) {
        const existing = await projects.findOne({
          workspace,
          name: 'Inbox',
          createdBy: owner,
        });
        project = existing
          ? (existing._id as Types.ObjectId)
          : (
              await projects.insertOne({
                workspace,
                name: 'Inbox',
                description: 'Tasks created before workspaces existed',
                status: 'ACTIVE',
                startDate: null,
                dueDate: null,
                createdBy: owner,
                deletedAt: null,
                createdAt: now,
                updatedAt: now,
              })
            ).insertedId;
        await addProjectMember(project, workspace, owner);
        inboxCache.set(String(owner), project);
      }
      return { project, workspace };
    };

    const labelId = async (
      workspace: Types.ObjectId,
      name: string,
      createdBy: Types.ObjectId,
    ) => {
      const label = await labels.findOneAndUpdate(
        { workspace, name },
        {
          $setOnInsert: {
            workspace,
            name,
            color: '#64748b',
            createdBy,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          upsert: true,
          returnDocument: 'after',
          collation: { locale: 'en', strength: 2 },
        },
      );
      return label.value._id as Types.ObjectId;
    };

    // Legacy tasks: { assignedTo, project?, labels: string[], tags: string[], isDeleted, isArchived }
    for await (const t of tasks.find({ workspace: { $exists: false } })) {
      const creator = t.createdBy as Types.ObjectId;
      let target: {
        project: Types.ObjectId;
        workspace: Types.ObjectId;
      } | null = null;
      if (t.project) {
        const project = await projects.findOne({
          _id: t.project,
          workspace: { $exists: true },
        });
        if (project)
          target = { project: project._id, workspace: project.workspace };
      }
      target ??= await inbox(creator);

      const names = [
        ...new Set<string>(
          [...(t.labels ?? []), ...(t.tags ?? [])].filter(
            (n) => typeof n === 'string' && n.trim(),
          ),
        ),
      ];
      // Case-insensitive collation can map "Backend" and "backend" to one label.
      const labelIds = new Map<string, Types.ObjectId>();
      for (const name of names) {
        const id = await labelId(
          target.workspace,
          name.trim().slice(0, 40),
          creator,
        );
        labelIds.set(String(id), id);
      }

      const status = STATUS_MAP[t.status] ?? t.status ?? 'TODO';
      // Personal workspaces have one member, so only self-assignments survive.
      const assignee =
        t.assignedTo && String(t.assignedTo) === String(creator)
          ? t.assignedTo
          : null;
      await tasks.updateOne(
        { _id: t._id },
        {
          $set: {
            workspace: target.workspace,
            project: target.project,
            parentTask: null,
            assignee,
            labels: [...labelIds.values()],
            status,
            priority:
              t.priority === 'CRITICAL' ? 'URGENT' : t.priority ?? 'MEDIUM',
            completedAt: status === 'DONE' ? t.updatedAt ?? now : null,
            deletedAt: t.isDeleted || t.isArchived ? t.updatedAt ?? now : null,
            position:
              (t.createdAt as Date | undefined)?.getTime() ?? now.getTime(),
            startDate: null,
            dueReminderSentAt: null,
          },
          $unset: {
            assignedTo: '',
            tags: '',
            actualHours: '',
            isDeleted: '',
            isArchived: '',
          },
        },
      );
    }

    // Legacy comments carried soft-delete flags and no scope.
    const comments = db.collection('comments');
    await comments.deleteMany({ isDeleted: true });
    for await (const c of comments.find({ workspace: { $exists: false } })) {
      const task = await tasks.findOne({ _id: c.task });
      if (!task?.workspace) {
        await comments.deleteOne({ _id: c._id });
        continue;
      }
      await comments.updateOne(
        { _id: c._id },
        {
          $set: {
            workspace: task.workspace,
            project: task.project,
            mentions: [],
            editedAt: null,
          },
          $unset: { isDeleted: '' },
        },
      );
    }

    // Legacy notifications/attachments used incompatible shapes and were never reachable (modules were disabled).
    await db
      .collection('notifications')
      .deleteMany({ recipient: { $exists: false } });
    await db
      .collection('attachments')
      .deleteMany({ storageKey: { $exists: false } });
  },
};
