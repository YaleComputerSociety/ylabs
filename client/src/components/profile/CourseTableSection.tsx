/**
 * Profile tab displaying course information from CourseTable API.
 */
import { useState, useEffect } from 'react';
import axios from '../../utils/axios';

interface CourseTableCourse {
  course_code: string;
  title: string;
  season_code: string;
  description?: string;
  professor_names: string[];
}

interface CourseTableSectionProps {
  netid: string;
  onAvailabilityChange?: (available: boolean) => void;
}

function formatSeason(code: string): string {
  const year = code.substring(0, 4);
  const sem = code.substring(4);
  const semName = sem === '01' ? 'Spring' : sem === '03' ? 'Fall' : `Term ${sem}`;
  return `${semName} ${year}`;
}

const CourseTableSection = ({ netid, onAvailabilityChange }: CourseTableSectionProps) => {
  const [courses, setCourses] = useState<CourseTableCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    axios
      .get(`/profiles/${netid}/courses`)
      .then((res) => {
        const isAvailable = res.data.available && res.data.courses?.length > 0;
        setCourses(res.data.courses || []);
        setAvailable(isAvailable);
        onAvailabilityChange?.(isAvailable);
      })
      .catch(() => {
        setAvailable(false);
        onAvailabilityChange?.(false);
      })
      .finally(() => setLoading(false));
  }, [netid]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!available || courses.length === 0) {
    return <p className="text-gray-500 text-sm py-8 text-center">Course data not available.</p>;
  }

  const bySeason = new Map<string, CourseTableCourse[]>();
  for (const course of courses) {
    const key = course.season_code;
    if (!bySeason.has(key)) bySeason.set(key, []);
    bySeason.get(key)!.push(course);
  }

  const sortedSeasons = [...bySeason.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-400">Course data from CourseTable</p>
      {sortedSeasons.map((season) => (
        <section key={season}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{formatSeason(season)}</h3>
          <div className="space-y-2">
            {bySeason.get(season)!.map((course, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <span className="text-xs font-mono text-blue-600 whitespace-nowrap mt-0.5">
                  {course.course_code}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 font-medium">{course.title}</p>
                  {course.description && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {course.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default CourseTableSection;
