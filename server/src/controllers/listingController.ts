import { Request, Response } from "express";
import mongoose from 'mongoose';
import { 
  archiveListing, 
  createListing, 
  deleteListing, 
  readListing, 
  unarchiveListing, 
  updateListing, 
  getSkeletonListing, 
  addView 
} from '../services/listingService';
import { readUser } from '../services/userService';
import { Listing } from "../models";

export const searchListings = async (request: Request, response: Response) => {
  try {
    let { query, sortBy, sortOrder, departments, page = 1, pageSize = 10 } = request.query;

    const synonymMap: { [key: string]: string } = {
      'cs': 'computer science',
      'comp sci': 'computer science',
      'computing': 'computer science',
      'compsci': 'computer science',
      
      'ml': 'machine learning',
      'ai': 'artificial intelligence',
      'deep learning': 'machine learning artificial intelligence',
      'neural nets': 'neural networks',
      'nlp': 'natural language processing',
      'cv': 'computer vision',
      'rl': 'reinforcement learning',
      
      'hci': 'human computer interaction',
      'ui': 'user interface',
      'ux': 'user experience',
      
      'algorithms': 'algorithm computer science',
      'data structures': 'algorithms computer science',
      'algo': 'algorithms',
      
      'cybersecurity': 'computer security',
      'infosec': 'information security',
      'crypto': 'cryptography',
      
      'software engineering': 'software development programming',
      'swe': 'software engineering',
      'programming': 'software development coding',
      'coding': 'programming',
      
      'db': 'database',
      'databases': 'database systems',
      'sql': 'database',
      
      'web dev': 'web development',
      'frontend': 'front end development',
      'backend': 'back end development',
      'fullstack': 'full stack development',
      
      'os': 'operating systems',
      'networks': 'computer networks networking',
      'distributed systems': 'distributed computing',
      
      'data sci': 'data science',
      'data science': 'data analysis statistics machine learning',
      'ds': 'data science',
      
      'stats': 'statistics',
      'statistical': 'statistics',
      'biostatistics': 'biostatistics statistics biology',
      'biostats': 'biostatistics',
      
      'data analysis': 'statistics data science',
      'data mining': 'data science machine learning',
      'big data': 'data science',
      
      'quant': 'quantitative analysis',
      'quantitative methods': 'statistics',
      
      'math': 'mathematics',
      'maths': 'mathematics',
      'applied math': 'applied mathematics',
      
      'calculus': 'mathematics calculus',
      'calc': 'calculus',
      'linear algebra': 'mathematics algebra',
      'linalg': 'linear algebra',
      
      'discrete math': 'discrete mathematics',
      'number theory': 'mathematics',
      'topology': 'mathematics topology',
      'geometry': 'mathematics geometry',
      
      'analysis': 'mathematical analysis',
      'real analysis': 'mathematics analysis',
      'complex analysis': 'mathematics analysis',
      
      'probability': 'probability theory statistics',
      'stochastic': 'probability stochastic processes',
      
      'optimization': 'mathematical optimization',
      'operations research': 'optimization mathematics',
      'or': 'operations research',
      
      'bio': 'biology',
      'bioscience': 'biology',
      'biological sciences': 'biology',
      'life sciences': 'biology',
      
      'molecular bio': 'molecular biology',
      'molbio': 'molecular biology',
      'cell bio': 'cell biology',
      'microbio': 'microbiology',
      
      'genetics': 'genetics genomics',
      'genomics': 'genetics genomics',
      'genome': 'genomics',
      
      'neuro': 'neuroscience',
      'neurobiology': 'neuroscience biology',
      'neurosci': 'neuroscience',
      'brain science': 'neuroscience',
      'cognitive neuroscience': 'neuroscience cognition',
      'systems neuroscience': 'neuroscience',
      
      'ecology': 'ecology environmental science',
      'evolution': 'evolutionary biology',
      'evo': 'evolution',
      'evo bio': 'evolutionary biology',
      
      'immunology': 'immunology biology',
      'immuno': 'immunology',
      
      'biochem': 'biochemistry',
      'biochemistry': 'biochemistry biology chemistry',
      
      'biophysics': 'biophysics biology physics',
      'bioengineering': 'bioengineering biology engineering',
      'biomedical engineering': 'bioengineering biology',
      'bme': 'biomedical engineering',
      
      'developmental bio': 'developmental biology',
      'stem cells': 'stem cell biology',
      
      'marine bio': 'marine biology',
      'botany': 'plant biology botany',
      'plant science': 'plant biology',
      
      'chem': 'chemistry',
      'organic chem': 'organic chemistry',
      'orgo': 'organic chemistry',
      'inorganic chem': 'inorganic chemistry',
      'physical chem': 'physical chemistry',
      'analytical chem': 'analytical chemistry',
      
      'chemical engineering': 'chemistry engineering',
      'cheme': 'chemical engineering',
      
      'phys': 'physics',
      'astrophysics': 'physics astronomy',
      'astro': 'astronomy astrophysics',
      'cosmology': 'astronomy physics',
      
      'quantum': 'quantum mechanics physics',
      'quantum mechanics': 'physics quantum',
      'qm': 'quantum mechanics',
      
      'particle physics': 'physics particles',
      'nuclear physics': 'physics nuclear',
      'condensed matter': 'physics condensed matter',
      
      'theoretical physics': 'physics theory',
      'applied physics': 'physics',
      
      'eng': 'engineering',
      'mechanical eng': 'mechanical engineering',
      'electrical eng': 'electrical engineering',
      'ee': 'electrical engineering',
      'civil eng': 'civil engineering',
      
      'aerospace': 'aerospace engineering',
      'aero': 'aerospace engineering',
      
      'materials science': 'materials science engineering',
      'robotics': 'robotics engineering',
      
      'med': 'medicine',
      'medical': 'medicine',
      'clinical': 'clinical medicine',
      
      'public health': 'public health epidemiology',
      'epidemiology': 'epidemiology public health',
      'epi': 'epidemiology',
      
      'global health': 'public health global health',
      
      'psych': 'psychology',
      'cognitive science': 'cognitive science psychology',
      'cogsci': 'cognitive science',
      'cognition': 'cognitive science',
      
      'neuro psych': 'neuropsychology',
      'clinical psych': 'clinical psychology',
      'social psych': 'social psychology',
      'developmental psych': 'developmental psychology',
      
      'behavioral science': 'psychology behavior',
      'behavior': 'behavioral science psychology',
      
      'econ': 'economics',
      'economics': 'economics',
      'econometrics': 'economics statistics',
      'macro': 'macroeconomics',
      'micro': 'microeconomics',
      
      'poli sci': 'political science',
      'politics': 'political science',
      'polisci': 'political science',
      'government': 'political science government',
      
      'soc': 'sociology',
      'sociological': 'sociology',
      
      'anthro': 'anthropology',
      'anthropological': 'anthropology',
      
      'linguistics': 'linguistics language',
      'ling': 'linguistics',
      
      'env': 'environmental',
      'environment': 'environmental science',
      'environmental studies': 'environmental science',
      'env science': 'environmental science',
      'env studies': 'environmental science',
      
      'climate': 'climate science environmental',
      'climate change': 'climate science',
      'climate science': 'environmental science climate',
      
      'sustainability': 'sustainability environmental',
      
      'geo': 'geology',
      'geology': 'geology earth science',
      'earth science': 'geology environmental',
      'geoscience': 'geology',
      
      'oceanography': 'oceanography marine science',
      'ocean': 'oceanography marine science',
      
      'history': 'history historical',
      'hist': 'history',
      
      'lit': 'literature',
      'literature': 'literature english',
      
      'philosophy': 'philosophy',
      'phil': 'philosophy',
      
      'art history': 'art history arts',
      
      'computational bio': 'computational biology bioinformatics',
      'bioinformatics': 'bioinformatics computational biology',
      'compbio': 'computational biology',
      
      'systems bio': 'systems biology',
      'synthetic bio': 'synthetic biology',
      
      'quantitative bio': 'quantitative biology',
      
      'computational neuroscience': 'neuroscience computational',
      
      'digital humanities': 'humanities digital',
      
      'game theory': 'game theory mathematics economics',
      
      'network science': 'networks graph theory',
      'complex systems': 'complex systems',
      
      'human rights': 'human rights law',
      
      'modeling': 'mathematical modeling simulation',
      'simulation': 'simulation modeling',
      'computational modeling': 'modeling simulation',
      
      'imaging': 'imaging microscopy',
      'microscopy': 'microscopy imaging',
      
      'spectroscopy': 'spectroscopy',
      
      'clinical trials': 'clinical trials research',
      'rct': 'randomized controlled trial',
      
      'vr': 'virtual reality',
      'ar': 'augmented reality',
      'xr': 'extended reality',
      
      'iot': 'internet of things',
      
      'blockchain': 'blockchain cryptocurrency',
      'bitcoin': 'cryptocurrency blockchain',
      
      'quantum computing': 'quantum computing',
      
      '3d printing': '3d printing additive manufacturing',
      
      'drones': 'drones uav',
      'uav': 'unmanned aerial vehicle drones',
      
      'finance': 'finance economics',
      'fintech': 'financial technology',
      
      'marketing': 'marketing business',
      'management': 'management business',
      
      'entrepreneurship': 'entrepreneurship startups',
      'startups': 'entrepreneurship startups',
      
      'law': 'law legal',
      'legal': 'law legal studies',
      
      'policy': 'policy political science',
      'public policy': 'public policy',
      
      'ed': 'education',
      'educational': 'education',
      'pedagogy': 'education pedagogy',
      
      'ethics': 'ethics philosophy',
      'bioethics': 'bioethics ethics medicine',
      
      'justice': 'justice law',
      'inequality': 'inequality social science',
      
      'race': 'race ethnicity social science',
      'gender': 'gender studies',
      
      'development': 'development economics',
      'international development': 'international development',
      
      'conflict': 'conflict resolution political science',
      'war': 'war conflict studies',
      
      'migration': 'migration immigration',
      'immigration': 'immigration migration'
    };

    const queryLower = (query as string)?.toLowerCase().trim();
    
    if (queryLower && synonymMap[queryLower]) {
      query = synonymMap[queryLower];
      console.log(`Synonym expansion: "${queryLower}" -> "${query}"`);
    }

    const order = (sortBy === "updatedAt" || sortBy === "createdAt") 
      ? sortOrder === "1" ? -1 : 1 
      : sortOrder === "1" ? 1 : -1;

    const pipeline: mongoose.PipelineStage[] = [];

    if (query) {
      pipeline.push({
        $search: {
          index: 'default',
          text: {
            query: query as string,
            path: {
              wildcard: '*'
            }
          },
        },
      });

      pipeline.push({
        $set: {
          searchScore: { $meta: 'searchScore' },
        },
      });
    }

    if (departments) {
      const departmentList = (departments as string).split(',');
      
      pipeline.push({
        $match: {
          departments: { $in: departmentList },
        },
      });
    }

    pipeline.push({
      $match: {
        archived: false,
        confirmed: true
      },
    });

    pipeline.push({
      $sort: sortBy 
        ? { [sortBy as string]: order, _id: 1 } 
        : { searchScore: -1, updatedAt: -1, _id: 1 },
    });

    pipeline.push(
      { $skip: (Number(page) - 1) * Number(pageSize) },
      { $limit: Number(pageSize) }
    );

    const results = await Listing.aggregate(pipeline);

    response.json({ results, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error("Error executing search:", error);
    response.status(500).json({ error: "Internal server error" });
  }
};

export const createListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const user = await readUser(currentUser.netId);
    const listing = await createListing(request.body.data, user);
    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
  }
};

export const getSkeletonListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await getSkeletonListing(currentUser.netId);
    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
  }
};

export const getListingById = async (request: Request, response: Response) => {
  try {
    const listing = await readListing(request.params.id);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const updateListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await updateListing(request.params.id, currentUser.netId, request.body.data);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const archiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await archiveListing(request.params.id, currentUser.netId);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const unarchiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await unarchiveListing(request.params.id, currentUser.netId);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const addViewToListing = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };

    const listing = await addView(request.params.id, currentUser.netId);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const deleteListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const currentListing = await readListing(request.params.id);
    if (currentUser.netId !== currentListing.ownerId) {
      const error: any = new Error(`User with id ${currentUser.netId} does not have permission to delete listing with id ${request.params.id}`);
      error.status = 403;
      throw error;
    }

    const deletedListing = await deleteListing(request.params.id);
    response.status(200).json({ deletedListing });
  } catch (error) {
    throw error;
  }
};