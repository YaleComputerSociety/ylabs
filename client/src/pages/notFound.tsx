import { Link } from 'react-router-dom';

const NotFound = () => {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen px-4">
            <div className="text-center max-w-md">
                <h1 className="text-9xl font-bold text-gray-300 mb-4">404</h1>
                <h2 className="text-3xl font-bold text-gray-800 mb-4">Page Not Found</h2>
                <p className="text-gray-600 mb-8">
                    Oops! The page you're looking for doesn't exist. It might have been moved or deleted.
                </p>
                <Link 
                    to="/" 
                    className="inline-block bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
                >
                    Go Back Home
                </Link>
            </div>
        </div>
    );
};

export default NotFound;