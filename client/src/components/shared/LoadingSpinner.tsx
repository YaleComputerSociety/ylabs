/**
 * Reusable loading spinner component.
 */
import PulseLoader from 'react-spinners/PulseLoader';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
}

const sizeMap = { sm: 6, md: 10, lg: 15 };

const LoadingSpinner = ({ size = 'md', inline = false }: LoadingSpinnerProps) => {
  const loader = <PulseLoader color="#3b82f6" size={sizeMap[size]} />;

  if (inline) return loader;

  return (
    <div className="flex justify-center items-center py-4">
      {loader}
    </div>
  );
};

export default LoadingSpinner;
