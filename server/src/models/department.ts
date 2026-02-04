import mongoose from 'mongoose';

// Department categories enum - aligned with Research Fields for consistent colors
export enum DepartmentCategory {
  COMPUTING_AI = "Computing & AI",
  LIFE_SCIENCES = "Life Sciences",
  PHYSICAL_SCIENCES = "Physical Sciences & Engineering",
  HEALTH_MEDICINE = "Health & Medicine",
  SOCIAL_SCIENCES = "Social Sciences",
  HUMANITIES_ARTS = "Humanities & Arts",
  ENVIRONMENTAL = "Environmental Sciences",
  ECONOMICS = "Economics",
  MATHEMATICS = "Mathematics"
}

// Category to colorKey mapping (aligned with Research Field colors in researchAreas.ts)
export const categoryColorKeys: Record<DepartmentCategory, number> = {
  [DepartmentCategory.COMPUTING_AI]: 0,        // blue
  [DepartmentCategory.LIFE_SCIENCES]: 1,       // green
  [DepartmentCategory.PHYSICAL_SCIENCES]: 2,   // yellow
  [DepartmentCategory.HEALTH_MEDICINE]: 3,     // red
  [DepartmentCategory.SOCIAL_SCIENCES]: 4,     // purple
  [DepartmentCategory.HUMANITIES_ARTS]: 5,     // pink
  [DepartmentCategory.ENVIRONMENTAL]: 6,       // teal
  [DepartmentCategory.ECONOMICS]: 7,           // orange
  [DepartmentCategory.MATHEMATICS]: 8          // indigo
};

const departmentSchema = new mongoose.Schema(
  {
    abbreviation: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    displayName: {
      type: String,  // "CPSC - Computer Science" format
      required: true,
      trim: true
    },
    categories: {
      type: [String],
      required: true,
      enum: Object.values(DepartmentCategory)
    },
    primaryCategory: {
      type: String,
      required: true,
      enum: Object.values(DepartmentCategory)
    },
    colorKey: {
      type: Number,  // 0-8 for frontend color mapping
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes for faster lookups
departmentSchema.index({ abbreviation: 1 });
departmentSchema.index({ name: 'text', abbreviation: 'text' });
departmentSchema.index({ primaryCategory: 1 });

export const Department = mongoose.model('departments', departmentSchema);
