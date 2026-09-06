import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
const app = await buildApp();

async function makeAuthedUser(email: string, phone: string) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email, phone, password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}
async function grantDisclaimer(token: string) {
  await app.inject({
    method: 'POST',
    url: '/consent',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
  });
}
async function pairAndOpenConflict(): Promise<{ aTok: string; bTok: string; conflictId: string }> {
  const aTok = await makeAuthedUser('a@x.com', '+5511900000080');
  const bTok = await makeAuthedUser('b@x.com', '+5511900000081');
  await grantDisclaimer(aTok);
  await grantDisclaimer(bTok);
  const inv = await app.inject({
    method: 'POST',
    url: '/couples/invite',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { inviteeEmail: 'b@x.com' },
  });
  await app.inject({
    method: 'POST',
    url: '/couples/accept',
    headers: { authorization: `Bearer ${bTok}` },
    payload: { code: inv.json().code },
  });
  llm.enqueue('r1');
  const c = await app.inject({
    method: 'POST',
    url: '/conflicts',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { initialContent: 'Brigamos por dinheiro. Ele acha que gasto demais.' },
  });
  return { aTok, bTok, conflictId: c.json().id };
}

beforeEach(async () => {
  setLlmProvider(llm);
  llm.calls.length = 0;
  await prisma.conflictBlock.deleteMany();
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
  await prisma.coupleTask.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.event.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.safetyScreening.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.loveMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

const validBlocksJson = JSON.stringify([
  'Nos últimos meses, tivemos discussões repetidas ao rever as contas do mês.',
  'Sinto insegurança quando não sei quanto sobra até o fim do mês.',
  'Preciso de mais previsibilidade financeira e conversas fora do calor do momento.',
]);

describe('Conflict blocks', () => {
  it('generates 3-6 blocks and stores them as proposed', async () => {
    const { aTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue(validBlocksJson);
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(201);
    const blocks = res.json().blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[0].status).toBe('proposed');
    expect(blocks[0].order).toBe(0);

    const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
    expect(conflict!.status).toBe('blocks_pending');
  });

  it('approves and removes and edits blocks', async () => {
    const { aTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue(validBlocksJson);
    const gen = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const blocks = gen.json().blocks;

    const approve = await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${blocks[0].id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'approved' },
    });
    expect(approve.json().status).toBe('approved');

    const remove = await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${blocks[1].id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'removed' },
    });
    expect(remove.json().status).toBe('removed');

    const edit = await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${blocks[2].id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'edited', content: 'versão minha' },
    });
    expect(edit.json().status).toBe('edited');
    expect(edit.json().content).toBe('versão minha');
  });

  it('rejects B trying to view or edit blocks (NOT_INITIATOR)', async () => {
    const { aTok, bTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue(validBlocksJson);
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/blocks`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_INITIATOR');
  });

  it('rejects generation when LOVE returns garbage', async () => {
    const { aTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue('desculpa, não consegui gerar');
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('BLOCK_GEN_FAILED');
  });
});
