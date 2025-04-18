export const validateTitle = (value: string): string | undefined => {
  return value.trim() ? undefined : "Title is required";
};

export const validateDescription = (value: string): string | undefined => {
  return value.trim() ? undefined : "Description is required";
};

export const validateEstablished = (value: string): string | undefined => {
  if (!value) return undefined; // Not required
  
  const year = parseInt(value, 10);
  const currentYear = new Date().getFullYear();
  
  if (isNaN(year) || !Number.isInteger(year)) {
    return "Year must be a valid integer";
  }
  
  if (year < 1701) {
    return `Yale wasn't established until 1701!`;
  }

  if (year > currentYear) {
    return `Year cannot be in the future`;
  }

  if (value.trim().includes(" ")) {
    return `Year cannot include spaces`;
  }

  if (year.toString() != value.trim()) {
    return `Year cannot include non-numeric characters`;
  }
  
  return undefined;
};

export const validateProfessors = (professors: string[]): string | undefined => {
  return professors.length > 0 ? undefined : "At least one professor is required";
};

export const validateEmails = (emails: string[]): string | undefined => {
  if (emails.length === 0) {
    return "At least one email is required";
  }
  
  for (const email of emails) {
    if (!email.includes('@') || !email.includes('.') || email.includes(' ')) {
      return `Invalid email format: ${email}`;
    }
  }
  
  return undefined;
};

export const validateWebsites = (websites: string[]): string | undefined => {
  if (websites.length === 0) return undefined; // Not required
  
  for (const website of websites) {
    if (!website.includes('.') || website.includes(' ')) {
      return `Invalid website format: ${website}`;
    }
  }
  
  return undefined;
};

export const validateProfessorIds = (professorIds: string[]): string | undefined => {
  if (professorIds.length > 3) {
    return "Maximum of 3 collaborators allowed"
  }
  
  const uniqueIds = new Set(professorIds);
  if (uniqueIds.size !== professorIds.length) {
    return "Please remove duplicate collaborators";
  }

  //must be alphanumeric (no spaces, apostrophes, etc)
  for (const id of professorIds) {
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      return `Invalid format for collaborator netid: ${id}`;
    }
  }

  return undefined;
};