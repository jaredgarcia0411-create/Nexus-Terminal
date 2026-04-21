export interface AgentServiceUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

const DISCORD_USER_MAP: Record<string, AgentServiceUser> = {
  '549621839350202387': {
    id: '504efa53-490c-425f-ade0-ca53d31d2f53',
    email: 'jared.garcia0411@gmail.com',
    name: 'Jared Garcia',
    picture: 'https://lh3.googleusercontent.com/a/ACg8ocJcBppldYPBHlDP8BsWhRTYLhJSfbKzWxVbfj3iArzRWNG4vQ=s96-c',
  },
  '369476207823028226': {
    id: 'dd16e992-d1b8-44a7-9750-575dcf30e13f',
    email: 'whiteheadbranden@gmail.com',
    name: 'Branden Whitehead',
    picture: null,
  },
  '373121471293161473': {
    id: 'ed96f038-6cdb-418f-886c-ad4e1459d3e0',
    email: 'ccatt5399@gmail.com',
    name: 'Cody Cattermole',
    picture: null,
  },
  '677335430336610315': {
    id: '4b4ccaa5-0f9f-4045-a9b6-38e738def81b',
    email: 'mikedurante13@gmail.com',
    name: 'Mike Durante',
    picture: null,
  },
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

export function requireServiceKey(request: Request): Response | null {
  const configuredKey = readConfiguredSecret('AGENT_SERVICE_KEY');
  if (!configuredKey) {
    return Response.json({ error: 'Service auth not configured' }, { status: 500 });
  }

  const providedKey = readHeader(request, 'x-agent-service-key');
  if (!providedKey || providedKey !== configuredKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function resolveDiscordUser(discordUserId: string): AgentServiceUser | null {
  return DISCORD_USER_MAP[discordUserId] ?? null;
}
