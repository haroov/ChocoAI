import { prisma } from '../../core/prisma';
import { registerRoute } from '../../utils/routesRegistry';

registerRoute('*', '/api/v1/webhook/email-verified/:tokenValue', async (req, res) => {
  const { tokenValue } = req.params;
  const token = await prisma.tokens.findFirst({ where: { value: tokenValue, type: 'email-verification' } });
  if (!token) res.status(404).json({ error: 'Token not found' });
  else {
    const user = await prisma.user.findUnique({ where: { id: token.userId } });
    if (!user) res.status(404).json({ error: 'User not found' });
    else {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailConfirmed: true },
      });
      await prisma.tokens.delete({ where: { id: token.id } });
      res.status(200).json({ ok: true });
    }
  }
});
