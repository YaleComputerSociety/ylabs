//Listings

export type Listing = {
  id: string;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerTitle?: string;
  ownerPrimaryDepartment?: string;
  professorIds: string[];
  professorNames: string[];
  title: string;
  departments: string[];
  emails: string[];
  websites: string[];
  description: string;
  applicantDescription: string;
  keywords: string[];
  researchAreas: string[];
  established: string;
  views: number;
  favorites: number;
  hiringStatus: number;
  archived: boolean;
  updatedAt: string;
  createdAt: string;
  confirmed: boolean;
  audited: boolean;
};

// Fellowships

export type FellowshipLink = {
  label: string;
  url: string;
};

export type Fellowship = {
  id: string;
  title: string;
  competitionType: string;
  summary: string;
  description: string;
  applicationInformation: string;
  eligibility: string;
  restrictionsToUseOfAward: string;
  additionalInformation: string;
  links: FellowshipLink[];
  applicationLink: string;
  awardAmount: string;
  isAcceptingApplications: boolean;
  applicationOpenDate: string | null;
  deadline: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactOffice: string;
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
  archived: boolean;
  audited: boolean;
  views: number;
  favorites: number;
  updatedAt: string;
  createdAt: string;
};

export type FellowshipStage = 'not_applied' | 'applied';

export type FellowshipFilterOptions = {
  yearOfStudy: string[];
  termOfAward: string[];
  purpose: string[];
  globalRegions: string[];
  citizenshipStatus: string[];
};

export type User = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
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