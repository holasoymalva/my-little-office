import type { OfficeConfig } from './office.types';

/**
 * START HERE.
 * Change this object to turn My Little Office into a content studio,
 * support center, sales team, research lab, or any other operation.
 */
export const officeConfig = {
  brand: {
    mark: 'M',
    name: 'MY LITTLE OFFICE',
    tagline: 'CUSTOM TEAM SIMULATOR',
  },
  theme: {
    ink: '#eee9df',
    muted: '#918e7f',
    line: '#3a352b',
    panel: '#171713',
    background: '#0e0d0b',
    accent: '#c7f43d',
    secondary: '#54e1d5',
  },
  system: { status: 'SPRINT ACTIVE', locale: 'en-US' },
  navigation: { office: 'OFFICE', pipeline: 'SPRINT' },
  stats: [
    { label: 'TEAM ONLINE', value: '5/5' },
    { label: 'SPRINT PROGRESS', value: '68%', trend: '+12%' },
    { label: 'OPEN PULL REQUESTS', value: '7' },
    { label: 'NEXT STAND-UP', value: '00:42:18' },
  ],
  workstreams: [
    { name: 'Web App', icon: '</>', detail: '12 active tasks', active: true },
    { name: 'API Platform', icon: 'API', detail: '8 active tasks' },
    { name: 'Mobile Client', icon: 'APP', detail: '5 active tasks' },
  ],
  goal: {
    current: 27,
    target: 34,
    unit: 'STORY POINTS',
    note: '7 points left to complete the sprint',
  },
  floor: {
    eyebrow: 'ENGINEERING HQ / SPRINT 24',
    officeTitle: 'Shipping software, together.',
    pipelineTitle: 'Ideas become reliable releases.',
    backgroundImage: '/assets/office/rustic-office.png',
    ariaLabel: 'Rustic pixel-art software office with brick walls, plants, desks, and collaboration areas',
    officeFooter: 'FOCUS HOURS · 09:00—18:00',
    pipelineFooter: 'PLAN → BUILD → REVIEW → TEST → RELEASE',
    zones: [
      { label: 'BUILD LOUNGE', className: 'zone-radar' },
      { label: 'QA LAB', className: 'zone-lab' },
      { label: 'PRODUCT ROOM', className: 'zone-story' },
      { label: 'CODE STUDIO', className: 'zone-studio' },
      { label: 'LEADERSHIP', className: 'zone-lounge' },
    ],
  },
  agents: [
    { id: 'TESS', role: 'QA Engineer', color: '#c7f43d', progress: 82, spriteRow: 0, tasks: ['Running regression tests', 'Reporting a flaky test', 'Verifying the latest fix'], route: [[24, 47], [43, 53], [11, 59]] },
    { id: 'DEV', role: 'Software Engineer', color: '#54e1d5', progress: 64, spriteRow: 2, tasks: ['Implementing the auth flow', 'Pairing with QA', 'Pushing a pull request'], route: [[24, 79], [46, 65], [50, 38]] },
    { id: 'PRIYA', role: 'Product Owner', color: '#ffb13b', progress: 91, spriteRow: 3, tasks: ['Refining the sprint backlog', 'Aligning acceptance criteria', 'Reviewing the product demo'], route: [[50, 47], [50, 65], [64, 58]] },
    { id: 'LEAD', role: 'Tech Lead', color: '#a884ff', progress: 73, spriteRow: 1, tasks: ['Reviewing the architecture', 'Unblocking an engineer', 'Approving the pull request'], route: [[75, 78], [62, 68], [75, 47]] },
    { id: 'MGR', role: 'Tech Manager', color: '#ff6868', progress: 88, spriteRow: 1, tasks: ['Checking team health', 'Planning next sprint capacity', 'Syncing with Product'], route: [[75, 47], [66, 57], [88, 62]] },
  ],
  activity: [
    { agent: 'TESS', message: 'passed the release suite', age: 'now', color: '#c7f43d' },
    { agent: 'DEV', message: 'opened pull request #184', age: '2m', color: '#54e1d5' },
    { agent: 'LEAD', message: 'approved the API design', age: '5m', color: '#a884ff' },
    { agent: 'PRIYA', message: 'refined the sprint scope', age: '9m', color: '#ffb13b' },
  ],
  queue: [
    { title: 'Authentication session refactor', category: 'BACKEND', priority: 95, state: 'In review' },
    { title: 'Add retries to billing webhooks', category: 'PLATFORM', priority: 91, state: 'In development' },
    { title: 'Checkout accessibility pass', category: 'FRONTEND', priority: 87, state: 'Ready for QA' },
    { title: 'Product analytics dashboard', category: 'PRODUCT', priority: 82, state: 'Discovery' },
  ],
  labels: {
    workstreams: 'WORKSTREAMS',
    goal: 'SPRINT GOAL',
    addWorkstream: 'ADD WORKSTREAM',
    selectedAgent: 'SELECTED TEAMMATE',
    activity: 'LIVE ACTIVITY',
    queue: 'SPRINT BOARD',
    queueNote: '4 HIGH-PRIORITY ITEMS',
    queueAction: 'OPEN BACKLOG →',
    score: 'PRIORITY',
    progress: 'PROGRESS',
    pause: 'Ⅱ PAUSE TEAM',
    resume: '▶ RESUME TEAM',
  },
  assetCredit: 'Characters: MetroCity Character Pack by JIK-A-4 · CC0 1.0',
} satisfies OfficeConfig;
