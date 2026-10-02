import { Fragment } from 'react';

const SlashBreakableText = ({ text }: { text: string }) => (
  <>
    {text.split('/').map((segment, index, segments) => (
      <Fragment key={index}>
        {segment}
        {index < segments.length - 1 && (
          <>
            /<wbr />
          </>
        )}
      </Fragment>
    ))}
  </>
);

export default SlashBreakableText;
