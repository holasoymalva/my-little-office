export type Point = readonly [number, number];

export type AgentConfig = {
  id: string;
  role: string;
  color: string;
  progress: number;
  spriteRow: number;
  tasks: readonly string[];
  route: readonly Point[];
};

export type OfficeConfig = {
  brand: { mark: string; name: string; tagline: string };
  theme: {
    ink: string;
    muted: string;
    line: string;
    panel: string;
    background: string;
    accent: string;
    secondary: string;
  };
  system: { status: string; locale: string };
  navigation: { office: string; pipeline: string };
  stats: readonly { label: string; value: string; trend?: string }[];
  workstreams: readonly { name: string; icon: string; detail: string; active?: boolean }[];
  goal: { current: number; target: number; unit: string; note: string };
  floor: {
    eyebrow: string;
    officeTitle: string;
    pipelineTitle: string;
    backgroundImage: string;
    ariaLabel: string;
    officeFooter: string;
    pipelineFooter: string;
    zones: readonly { label: string; className: string }[];
  };
  agents: readonly AgentConfig[];
  activity: readonly { agent: string; message: string; age: string; color: string }[];
  queue: readonly { title: string; category: string; priority: number; state: string }[];
  labels: {
    workstreams: string;
    goal: string;
    addWorkstream: string;
    selectedAgent: string;
    activity: string;
    queue: string;
    queueNote: string;
    queueAction: string;
    score: string;
    progress: string;
    pause: string;
    resume: string;
  };
  assetCredit: string;
};
