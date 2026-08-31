interface TeamMember {
  readonly eyebrow: string;
  readonly name: string;
  readonly role: string;
  readonly contribution: string;
  readonly portraitSrc: string;
  readonly portraitAlt: string;
  readonly githubLabel: string;
  readonly githubUrl: string;
}

const TEAM_MEMBERS = [
  {
    eyebrow: '01 / TEAM LEAD',
    name: 'Jingxuan Qian',
    role: 'MODEL TRAINING & ANALYSIS',
    contribution: 'Led model training, fine-tuning, checkpoint selection, and the B2-NJR error-analysis report.',
    portraitSrc: '/team/jingxuan-qian.png',
    portraitAlt: 'Jingxuan Qian portrait',
    githubLabel: '@aiden493km →',
    githubUrl: 'https://github.com/aiden493km',
  },
  {
    eyebrow: '02 / DATASET',
    name: 'Tianshi Bu',
    role: 'DATASET & PREPROCESSING',
    contribution: 'Prepared the Track5Data training and evaluation sets, 384 px preprocessing, and clean, robust, and ablation data support.',
    portraitSrc: '/team/tianshi-bu.png',
    portraitAlt: 'Tianshi Bu portrait',
    githubLabel: '@Tianshi-Bu →',
    githubUrl: 'https://github.com/Tianshi-Bu',
  },
  {
    eyebrow: '03 / WEB DELIVERY',
    name: 'Zhiyi Li',
    role: 'FULL-STACK WEB DELIVERY',
    contribution: 'Built the end-to-end WebDemo and dual delivery stack: FP32 model conversion, WebGPU/WASM inference, product UI, offline packaging, Vercel deployment, Blob-backed model delivery, integrity verification, and acceptance testing.',
    portraitSrc: '/team/zhiyi-li.png',
    portraitAlt: 'Zhiyi Li portrait',
    githubLabel: '@Awes0meE →',
    githubUrl: 'https://github.com/Awes0meE',
  },
  {
    eyebrow: '04 / COMMUNICATIONS',
    name: 'Mingxuan Chen',
    role: 'VIDEO & COMMUNICATIONS',
    contribution: 'Leads video editing, promotional storytelling, and submission media for the project.',
    portraitSrc: '/team/mingxuan-chen.png',
    portraitAlt: 'Mingxuan Chen portrait',
    githubLabel: '@CharlieC007 →',
    githubUrl: 'https://github.com/CharlieC007',
  },
] as const satisfies readonly TeamMember[];

export function TeamRoster() {
  return (
    <ol className="team-roster-grid" aria-label="LingShu Intelligence team">
      {TEAM_MEMBERS.map((member) => (
        <li className="team-profile" key={member.name}>
          <div className="team-portrait-frame">
            <img
              className="team-portrait-image"
              src={member.portraitSrc}
              alt={member.portraitAlt}
              width="1254"
              height="1254"
              loading="lazy"
              decoding="async"
            />
          </div>
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
