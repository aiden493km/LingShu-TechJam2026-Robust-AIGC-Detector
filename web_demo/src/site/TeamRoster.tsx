interface TeamMember {
  readonly eyebrow: string;
  readonly name: string;
  readonly role: string;
  readonly contribution: string;
  readonly githubLabel: string;
  readonly githubUrl: string;
}

const TEAM_MEMBERS = [
  {
    eyebrow: '01 / TEAM LEAD',
    name: 'Jingxuan Qian',
    role: 'MODEL TRAINING & ANALYSIS',
    contribution: 'Led model training, fine-tuning, checkpoint selection, and the B2-NJR error-analysis report.',
    githubLabel: '@aiden493km →',
    githubUrl: 'https://github.com/aiden493km',
  },
  {
    eyebrow: '02 / DATASET',
    name: 'Tianshi Bu',
    role: 'DATASET & PREPROCESSING',
    contribution: 'Prepared the Track5Data training and evaluation sets, 384 px preprocessing, and clean, robust, and ablation data support.',
    githubLabel: '@Tianshi-Bu →',
    githubUrl: 'https://github.com/Tianshi-Bu',
  },
  {
    eyebrow: '03 / WEB DELIVERY',
    name: 'Zhiyi Li',
    role: 'FULL-STACK WEB DELIVERY',
    contribution: 'Built the end-to-end WebDemo and dual delivery stack: FP32 model conversion, WebGPU/WASM inference, product UI, offline packaging, Vercel deployment, Blob-backed model delivery, integrity verification, and acceptance testing.',
    githubLabel: '@Awes0meE →',
    githubUrl: 'https://github.com/Awes0meE',
  },
  {
    eyebrow: '04 / COMMUNICATIONS',
    name: 'Mingxuan Chen',
    role: 'VIDEO & COMMUNICATIONS',
    contribution: 'Leads video editing, promotional storytelling, and submission media for the project.',
    githubLabel: '@CharlieC007 →',
    githubUrl: 'https://github.com/CharlieC007',
  },
] as const satisfies readonly TeamMember[];

export function TeamRoster() {
  return (
    <ol className="team-roster-grid" aria-label="LingShu Intelligence team">
      {TEAM_MEMBERS.map((member) => (
        <li className="team-profile" key={member.name}>
          <div className="team-portrait-frame" aria-hidden="true" />
          <p className="team-profile-eyebrow">{member.eyebrow}</p>
          <h3 className="team-profile-name">{member.name}</h3>
          <p className="team-profile-role">{member.role}</p>
          <p className="team-profile-contribution">{member.contribution}</p>
          <a
            className="team-profile-github"
            href={member.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Visit ${member.name} on GitHub`}
          >
            {member.githubLabel}
          </a>
        </li>
      ))}
    </ol>
  );
}
