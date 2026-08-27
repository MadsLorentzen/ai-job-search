import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');
const ROOT_DIR = path.resolve(__dirname, '../../../');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default candidate profile structure
const DEFAULT_PROFILE = {
  identity: {
    name: 'Jane Doe',
    title: 'Senior Software Engineer / AI Specialist',
    email: 'jane.doe@example.com',
    phone: '+1 (555) 123-4567',
    location: 'San Francisco, CA / Remote',
    linkedin: 'linkedin.com/in/janedoe',
    github: 'github.com/janedoe',
    portfolio: 'janedoe.dev',
    summary: 'Full-stack software engineer with 6+ years of experience building resilient distributed systems, agentic workflows, and cloud-native applications.',
    status: 'Actively Looking',
    languages: [
      { language: 'English', level: 'Native / Fluent' },
      { language: 'German', level: 'B2 / Professional Working' }
    ]
  },
  education: [
    {
      degree: 'M.S. in Computer Science',
      institution: 'Stanford University',
      period: '2018 - 2020',
      thesis: 'Scalable Distributed Architectures for Latency-Critical Systems',
      highlights: 'Specialization in Distributed Systems & Machine Learning.'
    },
    {
      degree: 'B.S. in Software Engineering',
      institution: 'University of California, Berkeley',
      period: '2014 - 2018',
      thesis: '',
      highlights: 'Graduated Magna Cum Laude.'
    }
  ],
  experience: [
    {
      title: 'Senior Software Engineer',
      company: 'TechFlow Systems',
      location: 'San Francisco, CA (Hybrid)',
      period: '2021 - Present',
      bullets: [
        'Architected high-throughput microservices processing over 120M events/day using Node.js, Go, and Redis with sub-30ms latency.',
        'Led a team of 5 engineers migrating monolithic backend to containerized Kubernetes infrastructure, reducing cloud operational expenditure by 28%.',
        'Implemented automated CI/CD deployment pipelines with comprehensive unit and integration testing suites, cutting release cycle time by 45%.'
      ]
    },
    {
      title: 'Software Engineer',
      company: 'DataPulse Corp',
      location: 'San Jose, CA',
      period: '2019 - 2021',
      bullets: [
        'Developed customer-facing dashboard components with React, TypeScript, and Tailwind CSS, increasing enterprise user engagement by 35%.',
        'Integrated multi-tier caching and query optimization in PostgreSQL database, reducing query latency by 60%.'
      ]
    }
  ],
  skills: {
    primary: ['TypeScript', 'JavaScript', 'Node.js', 'Python', 'React', 'Go', 'PostgreSQL', 'Docker', 'Kubernetes', 'AWS'],
    secondary: ['Redis', 'GraphQL', 'Terraform', 'Next.js', 'FastAPI', 'Tailwind CSS', 'Git', 'Linux', 'CI/CD'],
    domain: ['Distributed Systems', 'Cloud Architecture', 'API Design', 'Agentic AI Workflows', 'Performance Optimization'],
    tools: ['VS Code', 'Git', 'Postman', 'Docker', 'Jest', 'Webpack', 'Vite', 'Datadog']
  },
  starStories: [
    {
      id: 'story-1',
      title: 'Monolith to Microservices Cloud Migration',
      situation: 'TechFlow core application suffered high latency and deployment bottlenecks due to tightly coupled legacy architecture.',
      task: 'Lead the architecture migration to microservices while maintaining 99.99% uptime with zero customer disruption.',
      action: 'Designed domain-driven microservices in Go and Node.js, introduced Kafka for asynchronous messaging, and implemented canary deployments via Kubernetes.',
      result: 'Reduced p99 latency from 450ms to 28ms, improved release velocity from bi-weekly to daily deployments, and cut AWS spend by 28%.'
    },
    {
      id: 'story-2',
      title: 'Critical Database Bottleneck Resolution',
      situation: 'Black Friday surge caused DB query spikes and connection pool exhaustion on the main order processing service.',
      task: 'Diagnose and resolve the database latency issue under active production traffic.',
      action: 'Profiled query logs, created composite indexes on high-frequency tables, and implemented a multi-level Redis caching strategy.',
      result: 'Slashed peak DB CPU load by 70% and successfully handled 4x normal transaction volume without single error.'
    }
  ],
  targetQueries: [
    { query: 'Senior Software Engineer', location: 'Remote', portal: 'linkedin-search' },
    { query: 'Full Stack Engineer', location: 'San Francisco, CA', portal: 'freehire-search' },
    { query: 'Backend Developer', location: 'Remote', portal: 'freehire-search' }
  ],
  salary: {
    minimum: '$150,000 / year',
    target: '$180,000 / year',
    currency: 'USD'
  }
};

// Storage Service Methods
export const storageService = {
  getProfile() {
    try {
      if (!fs.existsSync(PROFILE_FILE)) {
        fs.writeFileSync(PROFILE_FILE, JSON.stringify(DEFAULT_PROFILE, null, 2), 'utf-8');
        return DEFAULT_PROFILE;
      }
      const data = fs.readFileSync(PROFILE_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading profile:', err);
      return DEFAULT_PROFILE;
    }
  },

  saveProfile(profileData) {
    try {
      fs.writeFileSync(PROFILE_FILE, JSON.stringify(profileData, null, 2), 'utf-8');
      return profileData;
    } catch (err) {
      console.error('Error saving profile:', err);
      throw err;
    }
  },

  getApplications() {
    try {
      if (!fs.existsSync(APPLICATIONS_FILE)) {
        fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify([], null, 2), 'utf-8');
        return [];
      }
      const data = fs.readFileSync(APPLICATIONS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading applications:', err);
      return [];
    }
  },

  saveApplication(application) {
    try {
      const apps = this.getApplications();
      const existingIdx = apps.findIndex(a => a.id === application.id);
      if (existingIdx >= 0) {
        apps[existingIdx] = { ...apps[existingIdx], ...application, updatedAt: new Date().toISOString() };
      } else {
        apps.unshift({
          ...application,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(apps, null, 2), 'utf-8');
      return application;
    } catch (err) {
      console.error('Error saving application:', err);
      throw err;
    }
  },

  deleteApplication(id) {
    try {
      let apps = this.getApplications();
      apps = apps.filter(a => a.id !== id);
      fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(apps, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      console.error('Error deleting application:', err);
      throw err;
    }
  },

  getRootDir() {
    return ROOT_DIR;
  }
};
