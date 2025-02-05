import { Developer } from "../types/types";

interface DeveloperCardProps {
    developer: Developer;
}

const DeveloperCard = ({ developer }: DeveloperCardProps) => {
    if (!developer) {
        return null;
    }
    
    return(
        <div>
            <img 
                src={developer.image ? developer.image : "assets/developers/no-user.png"}
                alt={`${developer.name} Profile Picture`}
                className="aspect-square object-cover w-full rounded-lg mb-2"
                width={500}
                height={500}
            />
            <h3 className="text-xl font-semibold">{developer.name}</h3>
            <p className="text-gray-700">{developer.position}</p>
            <p className="text-gray-700 mb-1">{developer.location}</p>
            {developer.website && (
                <a href={developer.website} target="_blank" rel="noopener noreferrer">
                    <img src="/assets/icons/website-icon.png" alt={`${developer.name} Website`} width={20} height={20} className="inline-block" /> 
                </a>
            )}
            {developer.linkedin && (
                <a href={developer.linkedin} target="_blank" rel="noopener noreferrer">
                    <img src="/assets/icons/linkedin-icon.png" alt={`${developer.name} LinkedIn`} width={28} height={28} className="inline-block" /> 
                </a>
            )}
            {developer.github && (
                <a href={developer.github} target="_blank" rel="noopener noreferrer">
                    <img src="/assets/icons/github-icon.png" alt={`${developer.name} Website`} width={20} height={20} className="inline-block" /> 
                </a>
            )}
        </div>
    );
};

export default DeveloperCard;