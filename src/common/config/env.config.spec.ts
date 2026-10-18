import {
  isLocalMongoUri,
  mongoHosts,
  remoteDatabaseRefusal,
} from './env.config';

describe('mongoHosts', () => {
  it('reads the host and ignores credentials, port, database and options', () => {
    expect(mongoHosts('mongodb://user:p%40ss@127.0.0.1:27018/app?x=1')).toEqual(
      ['127.0.0.1'],
    );
    expect(
      mongoHosts('mongodb+srv://u:p@cluster0.abcde.mongodb.net/db'),
    ).toEqual(['cluster0.abcde.mongodb.net']);
  });

  it('reads every host of a replica-set string', () => {
    expect(mongoHosts('mongodb://a.example:27017,b.example:27017/db')).toEqual([
      'a.example',
      'b.example',
    ]);
  });
});

describe('isLocalMongoUri', () => {
  it.each([
    'mongodb://127.0.0.1:27017/taskify',
    'mongodb://localhost/taskify?replicaSet=rs0',
    'mongodb://localhost:27017,127.0.0.1:27018/taskify',
  ])('accepts %s', (uri) => expect(isLocalMongoUri(uri)).toBe(true));

  it.each([
    'mongodb+srv://u:p@cluster0.abcde.mongodb.net/taskify',
    'mongodb://localhost:27017,remote.example:27017/taskify',
    '',
  ])('rejects %s', (uri) => expect(isLocalMongoUri(uri)).toBe(false));
});

describe('remoteDatabaseRefusal', () => {
  const atlas = 'mongodb+srv://user:secret@cluster0.abcde.mongodb.net/Taskify';

  it('stops development from using a remote database', () => {
    const reason = remoteDatabaseRefusal('development', atlas, undefined);
    expect(reason).toContain('cluster0.abcde.mongodb.net');
    expect(reason).toContain('ALLOW_REMOTE_DB');
  });

  it('never prints credentials', () => {
    expect(remoteDatabaseRefusal(undefined, atlas, undefined)).not.toContain(
      'secret',
    );
  });

  it('treats a missing NODE_ENV as development', () => {
    expect(remoteDatabaseRefusal(undefined, atlas, undefined)).not.toBeNull();
  });

  it('lets production, local databases and an explicit opt-in through', () => {
    expect(remoteDatabaseRefusal('production', atlas, undefined)).toBeNull();
    expect(
      remoteDatabaseRefusal('development', 'mongodb://127.0.0.1/db', undefined),
    ).toBeNull();
    expect(remoteDatabaseRefusal('development', atlas, 'true')).toBeNull();
  });
});
