import { longTextParagraphs, type LongTextOptions } from '../../utils/longText';

type LongTextProps = LongTextOptions & {
  text: string | null | undefined;
  className?: string;
  paragraphClassName?: string;
};

const LongText = ({
  text,
  className,
  paragraphClassName = 'mt-3 first:mt-0',
  minAutoSplitCharacters,
  sentencesPerParagraph,
}: LongTextProps) => {
  const paragraphs = longTextParagraphs(text, {
    minAutoSplitCharacters,
    sentencesPerParagraph,
  });

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`} className={paragraphClassName}>
          {paragraph}
        </p>
      ))}
    </div>
  );
};

export default LongText;
