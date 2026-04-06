export interface AgentServiceUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

const DISCORD_USER_MAP: Record<string, AgentServiceUser> = {
  // 'discord-user-id-1': {
  //   id: 'nexus-user-id-1',
  //   email: 'user1@example.com',
  //   name: 'User One',
  //   picture: null,
  // },
};

function readHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
}

function readConfiguredSecret(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function requireAgentAdmin(request: Request): Response | null {
  const configuredKey = readConfiguredSecret('AGENT_ADMIN_KEY');
  if (!configuredKey) {
    return Response.json({ error: 'Admin auth not configured' }, { status: 500 });
  }

  const providedKey = readHeader(request, 'x-agent-admin-key');
  if (!providedKey || providedKey !== configuredKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function requireServiceAuth(
  request: Request,
  body: { discord_user_id?: string },
): { user: AgentServiceUser; discordUserId: string } | Response {
  const configuredKey = readConfiguredSecret('AGENT_SERVICE_KEY');
  if (!configuredKey) {
    return Response.json({ error: 'Service auth not configured' }, { status: 500 });
  }

  const providedKey = readHeader(request, 'x-agent-service-key');
  if (!providedKey || providedKey !== configuredKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const discordUserId = body.discord_user_id?.trim();
  if (!discordUserId) {
    return Response.json({ error: 'discord_user_id is required' }, { status: 400 });
  }

  const user = DISCORD_USER_MAP[discordUserId];
  if (!user) {
    return Response.json({ error: 'Unknown Discord user' }, { status: 403 });
  }

  return { user, discordUserId };
}
