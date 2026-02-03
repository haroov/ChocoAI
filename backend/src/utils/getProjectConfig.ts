import { config, prisma } from '../core';

const LEGACY_DEFAULT_SYSTEM_PROMPT = 'You are ChocoAI, a helpful assistant for Choco registration.';

export const DEFAULT_PROJECT_CONFIG: ProjectConfigData = {
  id: 1,
  llmProvider: config.llm.provider,
  llmModel: config.llm.model,
  temperature: config.llm.temperature,
  systemPrompt: [
    'You are ChocoAI (שוקו), a licensed-style insurance broker assistant chatting with a customer who wants to purchase insurance.',
    '',
    'Your job is to lead an end-to-end buying conversation (Hebrew or English, keep the same language):',
    '1) Identify the customer and the insured business (legal ID: ח"פ/ע"מ/ת"ז, business name, contact person).',
    '2) Clarify needs and underwriting basics (what they want to insure: structure/contents/third-party/employers liability/special risks like professional/para-medical/cyber/product liability).',
    '3) Collect missing details, then produce a proposal/intake payload and generate the required PDF proposal forms for the carrier.',
    '',
    'Tone: professional, warm, concise. Ask one question at a time. If the user provides multiple details, capture them all and continue.',
    'Never mention internal tools, flows, database, Prisma, or implementation details.',
  ].join('\n'),
  backendMode: 'choco', // Use real Choco API by default
  chocoBaseUrl: config.choco.baseUrl,
  chocoDashboardBaseUrl: config.choco.dashboardBaseUrl,
  chocoApiKey: config.choco.jwt || '',
  rateLimitRps: 3,
};

export const getProjectConfig = async (): Promise<ProjectConfigData> => {
  const cfg = await prisma.projectConfig.findUnique({ where: { id: 1 } });
  if (!cfg) {
    return await prisma.projectConfig.create({ data: DEFAULT_PROJECT_CONFIG }) as unknown as ProjectConfigData;
  }
  // Soft-migrate legacy defaults without overriding user-customized prompts.
  if (cfg.systemPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT) {
    const updated = await prisma.projectConfig.update({
      where: { id: 1 },
      data: { systemPrompt: DEFAULT_PROJECT_CONFIG.systemPrompt },
    });
    return updated as unknown as ProjectConfigData;
  }
  return cfg as unknown as ProjectConfigData;
};

export type ProjectConfigData = {
  id: number;
  llmProvider: string;
  llmModel: string;
  temperature: number;
  systemPrompt: string;
  backendMode: string;       // 'mock' | 'choco'
  chocoBaseUrl: string;
  chocoDashboardBaseUrl: string;
  chocoApiKey: string;
  rateLimitRps: number;
};
