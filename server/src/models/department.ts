/**
 * Mongoose schema and model for academic departments with category-based color mapping.
 */
import mongoose from 'mongoose';

export enum DepartmentCategory {
  COMPUTING_AI = 'Computing & AI',
  LIFE_SCIENCES = 'Life Sciences',
  PHYSICAL_SCIENCES = 'Physical Sciences & Engineering',
  HEALTH_MEDICINE = 'Health & Medicine',
  SOCIAL_SCIENCES = 'Social Sciences',
  HUMANITIES_ARTS = 'Humanities & Arts',
  ENVIRONMENTAL = 'Environmental Sciences',
  ECONOMICS = 'Economics',
  MATHEMATICS = 'Mathematics',
}

export const categoryColorKeys: Record<DepartmentCategory, number> = {
  [DepartmentCategory.COMPUTING_AI]: 0,
  [DepartmentCategory.LIFE_SCIENCES]: 1,
  [DepartmentCategory.PHYSICAL_SCIENCES]: 2,
  [DepartmentCategory.HEALTH_MEDICINE]: 3,
  [DepartmentCategory.SOCIAL_SCIENCES]: 4,
  [DepartmentCategory.HUMANITIES_ARTS]: 5,
  [DepartmentCategory.ENVIRONMENTAL]: 6,
  [DepartmentCategory.ECONOMICS]: 7,
  [DepartmentCategory.MATHEMATICS]: 8,
};

const departmentSchema = new mongoose.Schema(
  {
    abbreviation: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    categories: {
      type: [String],
      required: true,
      enum: Object.values(DepartmentCategory),
    },
    primaryCategory: {
      type: String,
      required: true,
      enum: Object.values(DepartmentCategory),
    },
    colorKey: {
      type: Number,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

departmentSchema.index({ abbreviation: 1 });
departmentSchema.index({ name: 'text', abbreviation: 'text' });
departmentSchema.index({ primaryCategory: 1 });

export const Department = mongoose.model('departments', departmentSchema);
