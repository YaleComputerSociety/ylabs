/**
 * Rebuild v4 ResearchGroup.opennessSignals and openness cache fields from legacy signals.
 */
import { Listing } from '../server/src/models/listing';
import { ResearchGroup } from '../server/src/models/researchGroup';
import {
  connectForMigration,
  disconnectForMigration,
  parseMigrationOptions,
} from './v4MigrationUtils';

const options = parseMigrationOptions();

type Strength = 'verified' | 'likely' | 'weak' | 'negative';

interface Signal {
  signalType: string;
  value: boolean;
  strength: Strength;
  confidence: number;
  observedAt: Date;
  expiresAt?: Date;
  evidenceText: string;
  sourceUrl?: string;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function computeStatus(group: any, signals: Signal[]): {
  opennessStatusCache: string;
  opennessExplanationCache: string[];
  opennessLastSignalAt?: Date;
} {
  if (group.activeAtYaleCache === false || group.yaleStatusCache === 'departed') {
    return { opennessStatusCache: 'not-available', opennessExplanationCache: ['No longer active at Yale'] };
  }

  const now = new Date();
  const active = signals.filter((s) => !s.expiresAt || s.expiresAt >= now);
  const explanations = active.map((s) => s.evidenceText).filter(Boolean).slice(0, 5);
  const opennessLastSignalAt = signals
    .map((s) => s.observedAt)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (active.some((s) => s.value && s.strength === 'verified')) {
    return { opennessStatusCache: 'verified-accepting', opennessExplanationCache: explanations, opennessLastSignalAt };
  }
  if (active.some((s) => s.value && s.strength === 'likely')) {
    return { opennessStatusCache: 'likely-accepting', opennessExplanationCache: explanations, opennessLastSignalAt };
  }
  return { opennessStatusCache: 'unknown', opennessExplanationCache: explanations, opennessLastSignalAt };
}

async function main(): Promise<void> {
  await connectForMigration('Backfill v4 openness signals', options);

  const groups = await ResearchGroup.find({})
    .sort({ _id: 1 })
    .limit(options.limit || 0)
    .lean<any[]>();

  let groupsUpdated = 0;
  let signalsBuilt = 0;

  for (const group of groups) {
    const observedAt = group.lastObservedAt || group.updatedAt || group.createdAt || new Date();
    const signals: Signal[] = [];

    const activeListings = await Listing.find({
      researchGroupId: group._id,
      archived: { $ne: true },
      confirmed: { $ne: false },
    }).lean<any[]>();

    for (const listing of activeListings) {
      signals.push({
        signalType: 'active-listing',
        value: true,
        strength: 'verified',
        confidence: 1,
        observedAt: listing.updatedAt || listing.createdAt || observedAt,
        expiresAt: listing.expiresAt || addMonths(listing.updatedAt || listing.createdAt || observedAt, 6),
        evidenceText: `Active listing: ${listing.title}`,
      });
    }

    if (group.acceptingUndergrads === true) {
      signals.push({
        signalType: 'pi-claim',
        value: true,
        strength: 'verified',
        confidence: group.acceptanceConfidence || 0.8,
        observedAt,
        expiresAt: addMonths(observedAt, 12),
        evidenceText: 'Previously marked as accepting undergraduates',
      });
    }

    if (group.offersIndependentStudy === true) {
      signals.push({
        signalType: 'indep-study-course',
        value: true,
        strength: 'likely',
        confidence: 0.75,
        observedAt,
        expiresAt: addMonths(observedAt, 18),
        evidenceText: 'Offers independent study or research course credit',
      });
    }

    if (group.undergradEvidenceQuote) {
      signals.push({
        signalType: 'lab-microsite-llm',
        value: true,
        strength: 'likely',
        confidence: 0.7,
        observedAt,
        expiresAt: addMonths(observedAt, 12),
        evidenceText: group.undergradEvidenceQuote,
      });
    }

    if ((group.pastUndergradAdvisees || []).length > 0 || Number(group.currentUndergradCount || 0) > 0) {
      signals.push({
        signalType: 'prior-undergrad-member',
        value: true,
        strength: 'weak',
        confidence: 0.45,
        observedAt,
        evidenceText: 'Has prior evidence of undergraduate involvement',
      });
    }

    const cache = computeStatus(group, signals);
    if (options.apply) {
      await ResearchGroup.updateOne(
        { _id: group._id },
        {
          $set: {
            opennessSignals: signals,
            ...cache,
            opennessComputedAt: new Date(),
          },
        },
      );
    }
    groupsUpdated++;
    signalsBuilt += signals.length;
  }

  console.log(`Groups scanned:  ${groups.length}`);
  console.log(`Groups updated:  ${groupsUpdated}${options.apply ? '' : ' (would update)'}`);
  console.log(`Signals built:   ${signalsBuilt}`);

  await disconnectForMigration();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectForMigration();
  process.exit(1);
});
