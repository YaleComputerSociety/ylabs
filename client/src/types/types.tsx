//Listings

export type Listing = {
  id: string;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  professorIds: string[];
  professorNames: string[];
  title: string;
  departments: string[];
  emails: string[];
  websites: string[];
  description: string;
  keywords: string[];
  established: string;
  views: number;
  favorites: number;
  hiringStatus: number;
  archived: boolean;
  updatedAt: string;
  createdAt: string;
  confirmed: boolean;
  applicationsEnabled: boolean;
  applicationQuestions: Array<{
    question: string;
    required: boolean;
  }>;
};

export type User = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
}

export type UserData = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
  resumeUrl?: string;
}


//Developer

export type Developer = {
  name: string;
  position: string;
  image?: string;
  location: string;
  website?: string;
  linkedin?: string;
  github?:string;
}

// Applications
export type Application = {
  _id: string;
  listingId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentNetId: string;
  resumeUrl?: string;
  coverLetter?: string;
  customQuestions: Array<{
    question: string;
    answer: string;
  }>;
  status: 'pending' | 'accepted' | 'rejected';
  professorNotes?: string;
  appliedAt: string;
  updatedAt: string;
  listing?: {
    title: string;
    ownerFirstName: string;
    ownerLastName: string;
    departments: string[];
  };
  student?: {
    fname: string;
    lname: string;
    email: string;
    netid: string;
  };
}

export type ApplicationStats = {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
}

interface ImportMeta {
  readonly env: {
    readonly VITE_APP_TITLE: string;
    readonly MODE: string;
    readonly BASE_URL: string;
    readonly PROD: boolean;
    readonly DEV: boolean;
    [key: string]: string | boolean | undefined;
  };
}