/**
 * Mongoose schema and model for research areas with field-based color mapping.
 */
import mongoose from 'mongoose';

export enum ResearchField {
  COMPUTING_AI = "Computing & Artificial Intelligence",
  LIFE_SCIENCES = "Life Sciences & Biology",
  PHYSICAL_SCIENCES = "Physical Sciences & Engineering",
  HEALTH_MEDICINE = "Health & Medicine",
  SOCIAL_SCIENCES = "Social Sciences",
  HUMANITIES_ARTS = "Humanities & Arts",
  ENVIRONMENTAL = "Environmental Sciences",
  ECONOMICS = "Economics",
  MATHEMATICS = "Mathematics"
}

export const fieldColorKeys: Record<ResearchField, string> = {
  [ResearchField.COMPUTING_AI]: "blue",
  [ResearchField.LIFE_SCIENCES]: "green",
  [ResearchField.PHYSICAL_SCIENCES]: "yellow",
  [ResearchField.HEALTH_MEDICINE]: "red",
  [ResearchField.SOCIAL_SCIENCES]: "purple",
  [ResearchField.HUMANITIES_ARTS]: "pink",
  [ResearchField.ENVIRONMENTAL]: "teal",
  [ResearchField.ECONOMICS]: "orange",
  [ResearchField.MATHEMATICS]: "indigo"
};

const researchAreaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    field: {
      type: String,
      required: true,
      enum: Object.values(ResearchField)
    },
    colorKey: {
      type: String,
      required: true,
      enum: ["blue", "green", "yellow", "red", "purple", "pink", "teal", "orange", "indigo", "gray"],
      default: "gray"
    },
    addedBy: {
      type: String,
      required: false
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

researchAreaSchema.index({ name: 'text' });
researchAreaSchema.index({ field: 1 });

export const ResearchArea = mongoose.model('researchAreas', researchAreaSchema);
