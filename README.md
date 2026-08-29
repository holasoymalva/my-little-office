# My Little Office

<img width="1024" height="508" alt="image" src="https://github.com/user-attachments/assets/823b61b9-8ec1-4af3-ab73-0023f7d8a445" />


A configurable pixel-art dashboard for visualizing teams, agents, workflows, and operational status. The included demo models a software development team with these roles:

- QA Engineer
- Software Engineer
- Product Owner
- Tech Lead
- Tech Manager

## Customize it

Most customizations happen in one file:

[`app/office.config.ts`](app/office.config.ts)

There you can change:

- Brand name, logo letter, and tagline
- Theme colors
- Dashboard metrics
- Workstreams and goals
- Team member names, roles, tasks, and colors
- Character movement routes
- Office zones
- Activity feed and work queue
- Office background image

Each movement route is a list of `[x, y]` percentages inside the office. For example:

```ts
route: [[24, 47], [43, 53], [11, 59]]
```

The reusable rendering and animation logic lives in `app/components`. You normally do not need to edit it when creating a new office.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validate a change

```bash
npm run build
```

## Assets

Character sprites come from the MetroCity Character Pack by JIK-A-4 under CC0 1.0. See `public/assets/metrocity/LICENSE.txt`.
