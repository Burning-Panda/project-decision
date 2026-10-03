export const U = {
  alice: 'alice@acme.com',
  bob: 'bob@acme.com',
  carol: 'carol@acme.com',
  david: 'david@acme.com',
  lead: 'lead@acme.com',
  outsider: 'eve@other.com',
  org: 'acme', // owner/customer identifier acts as organisation admin
};

export const CONTENT_V1 = `## Context

We need a database that scales.

## Decision

Move to PostgreSQL 16 and deprecate MySQL

## Consequences

### Negative

- Database replication overhead during transition
`;

export const CONTENT_V2 = `## Context

We need a database that scales.

## Decision

Move to PostgreSQL 16 within 90 days, maintain MySQL fallback for 30 days

## Consequences

### Negative

- Database replication overhead (mitigated by 30-day dual-write period)
`;

export const URL_OK = 'https://hooks.example.com/dl';
export const PUBLIC_DNS = async () => ['93.184.216.34'];

export const MEETING = {
  recorded_at: '2024-03-21T15:00:00Z',
  duration_seconds: 190,
  attendees: [U.alice, U.bob],
  audio_file_url: 's3://bucket/m1.webm',
  segments: [
    { start_seconds: 45, speaker: 'Bob', text: 'Rollback worries me.' },
    { start_seconds: 0, speaker: 'Alice', text: 'Let us start.' },
    { start_seconds: 130, speaker: 'Alice', text: 'We add a dual-write period.' },
  ],
  key_takeaways: ['Add dual-write period', 'Revisit in April'],
};

export const FOLLOWUP = {
  title: 'Benchmark PostgreSQL',
  assigned_to: U.bob,
  due_date: '2024-04-15',
  priority: 'high',
  description: 'Compare to MySQL 8',
};
