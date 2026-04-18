/**
 * Profile tab displaying research interests and topics.
 */
interface ResearchInterestsProps {
  interests: string[];
  topics: string[];
}

const ResearchInterests = ({ interests, topics }: ResearchInterestsProps) => {
  const hasInterests = interests && interests.length > 0;
  const hasTopics = topics && topics.length > 0;

  if (!hasInterests && !hasTopics) {
    return (
      <p className="text-gray-500 text-sm py-8 text-center">No research interests available.</p>
    );
  }

  return (
    <div className="space-y-6">
      {hasTopics && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Research Topics
          </h3>
          <div className="flex flex-wrap gap-2">
            {topics.map((topic) => (
              <span key={topic} className="text-sm px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700">
                {topic}
              </span>
            ))}
          </div>
        </section>
      )}

      {hasInterests && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Research Interests
          </h3>
          <div className="flex flex-wrap gap-2">
            {interests.map((interest) => (
              <span
                key={interest}
                className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700"
              >
                {interest}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default ResearchInterests;
