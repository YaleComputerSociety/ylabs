import csv
import os
import uuid
import time
from bs4 import BeautifulSoup
from listings_scraper import getDetailedListings
from generate_keywords import generateKeywordsTxt, createKeywordsCollection
from llama_cpp import Llama
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

#creates a csv with the processed information from base scraper
def createInitialListings(filename = 'raw_listings.csv'):
    #runs base scraper to scrape Yale directory with Selenium
    listings = getDetailedListings('a', 'z')

    #writes all listings from the base scraper to a new csv file
    with open(filename, 'w', newline = '') as file:
        writer = csv.writer(file)

        #writes the header/fields row
        fields = ['name', 'id', 'title', 'email', 'upi', 'unit', 'department', 'location', 'building', 'mailing']
        writer.writerow(fields)

        #processes the data by listing utilizing beautiful soup
        for listing in listings:
            soup = BeautifulSoup(str(listing), 'html.parser')

            name = soup.find('span', id = 'bps-final-name').text
            id = soup.find('span', id = 'bps-final-netid').text
            title = soup.find('p', id = 'bps-final-title').text
            email = soup.find('a', id = 'bps-final-email-anchor').text
            upi = soup.find('p', id = 'bps-final-upi').text
            unit = soup.find('p', id = 'bps-final-org').text
            department = soup.find('p', id = 'bps-final-org-unit').text
            location = soup.find('p', id = 'bps-final-office-addr').text
            building = soup.find('p', id = 'bps-final-location').text
            mailing = soup.find('p', id = 'bps-final-mailing-addr').text

            #adds processed data as a new, complete row, checking to make sure the row is not blank before doing so
            if(name != ""):
                writer.writerow([name, id, title, email, upi, unit, department, location, building, mailing])

#classifies each listing under a valid department name using embeddings to fin the most relevant/correlated department name
def classifyDepartments(inputFile, outputFile = "", verbose = False, batchSize = 50):
    #embeddings instruction taken from this rag video: https://www.youtube.com/watch?v=gigip1Pxf88&t=267s

    #marks if output is blank, meaning an intermediate file must be created and eventually destroyed
    blankOutput = outputFile == ''

    #creates intermediate copy of the input if output is its base parameter, meaning that the input file should be replaced with the returned csv
    if blankOutput:
        with open(inputFile, 'r') as input, open('intermediate.csv', 'w') as output:
            reader = csv.reader(input)
            writer = csv.writer(output)

            for row in reader:
                writer.writerow(row)
                
        outputFile = inputFile
        inputFile = 'intermediate.csv'
    
    #creates qdrant client
    client = QdrantClient(path = 'embeddings')

    #skeleton of queries fed to model
    prompt_skeleton = """Title: {title}
        Branch: {branch}
        Department: {department}"""
    
    #mxbai model from huggingface stored on computer at specified path
    #model link: https://huggingface.co/mixedbread-ai/mxbai-embed-large-v1
    llm = Llama(
            model_path = 'MODEL PATH HERE',
            embedding = True,
            verbose = False
        )
    
    #creates new qdrant collection of embeddings if it does not already exist
    if not client.collection_exists('departments'):
        departmentsPath = os.path.join('..', 'valid_departments.txt')

        with open(departmentsPath, 'r') as file:
            validDepartments = file.read().split('\n')

        #creates embeddigns
        departments_embeddings = [(department, llm.create_embedding(department)['data'][0]['embedding']) for department in validDepartments]

        #creates departments collection
        client.create_collection(
            collection_name = 'departments',
            vectors_config = VectorParams(size=1024, distance=Distance.COSINE)
        )

        #creates points with embeddings to add to collection
        points = [
            PointStruct(
                id = str(uuid.uuid4()),
                vector = embeddings,
                payload = {
                    "text": department
                }
            )
            for department, embeddings in departments_embeddings
        ]

        #adds created points to collection
        operation_info = client.upsert(
            collection_name = 'departments',
            wait = True,
            points = points
        )

    #prints and sets starting conditions if console updates are requested
    if verbose:
        print("Beginning department classification")
        start = time.time()
        lap = time.time()

        #gets total number of listings to classify
        with open(inputFile, 'r') as file:
            reader = csv.reader(file)
            listingsLength  = sum(1 for row in reader)
 
    #classifies departments for all listings
    with open(inputFile, 'r') as input, open(outputFile, 'w') as output:
        reader = csv.reader(input)
        writer = csv.writer(output)

        for index, row in enumerate(reader):
            #prints batch updates if console updates are requested
            if verbose & (index % batchSize == 0) & (index > 0):
                print(f'{index} of {listingsLength}, {round(index/listingsLength*100, 2)}%; batch time: {time.time() - lap}; total time: {time.time() - start}')
                lap = time.time()
            if row[0] != "name":
                #classifies and writes content rows of the original csv
                #formats query
                prompt = prompt_skeleton.format(title = row[2], branch = row[5], department = row[6])
                #creates query embedding
                prompt_vector = llm.create_embedding(prompt)['data'][0]['embedding']
                #finds most relevant embedding in departments collection (determined department match)
                department = client.search(
                    collection_name = 'departments',
                    query_vector = prompt_vector,
                    limit = 1
                )
                writer.writerow(row + [department[0].payload['text']])
            else:
                #writes header/fields row
                writer.writerow(row + ['department'])

    #prints completion update if console updates are requested
    if verbose:
        print(f"Done; total time: {time.time() - start}")

    #removes intermediate file if one was created
    if blankOutput:
        os.remove(inputFile)

def matchKeywords(inputFile, outputFile = "", verbose = False, batchSize = 50):
    client = QdrantClient(path = 'embeddings')
    
    if client.collection_exists('keywords'):
        blankOutput = outputFile == ''

        if blankOutput:
            with open(inputFile, 'r') as input, open('intermediate.csv', 'w') as output:
                reader = csv.reader(input)
                writer = csv.writer(output)

                for row in reader:
                    writer.writerow(row)
                    
            outputFile = inputFile
            inputFile = 'intermediate.csv'

        prompt_skeleton = """Title: {title}
            Branch: {branch}
            Department: {department}"""

        llm = Llama(
                model_path = 'MODEL PATH HERE',
                embedding = True,
                verbose = False
            )

        if verbose:
            print("Beginning keyword matching")
            start = time.time()
            lap = time.time()

            with open(inputFile, 'r') as file:
                reader = csv.reader(file)
                listingsLength  = sum(1 for row in reader)
    
        with open(inputFile, 'r') as input, open(outputFile, 'w') as output:
            reader = csv.reader(input)
            writer = csv.writer(output)

            for index, row in enumerate(reader):
                if verbose & (index % batchSize == 0) & (index > 0):
                    print(f'{index} of {listingsLength}, {round(index/listingsLength*100, 2)}%; batch time: {time.time() - lap}; total time: {time.time() - start}')
                    lap = time.time()
                if row[0] != "name":
                    prompt = prompt_skeleton.format(title = row[2], branch = row[5], department = row[6])
                    prompt_vector = llm.create_embedding(prompt)['data'][0]['embedding']
                    keywords = client.search(
                        collection_name = 'keywords',
                        query_vector = prompt_vector,
                        limit = 4
                    )
                    row.append([keyword.payload['text'] for keyword in keywords])
                    writer.writerow(row)
                else:
                    writer.writerow(row + ['keywords'])

        if verbose:
            print(f"Done; total time: {time.time() - start}")

        if blankOutput:
            os.remove(inputFile)
    else:
        print('Error: keywords embeddings collection does not currently exist. Please resolve by creating embeddings collection with generate_keywords.py before running script again')

#Run the following three lines to create a new full listings csv from scratch (otherwise, only run specific functions)

#Scrapes Yale directory and creates csv with acquired data
createInitialListings(filename = 'data/professor_listings.csv')
#Utilizes embeddings to match professors with deparatments (verbose set to true to show progress, as this takes longer)
classifyDepartments(inputFile = 'data/professor_listings.csv', verbose = True)
#Creates keywords bank txt file and then converts to a Qdrant collection for matching
generateKeywordsTxt()
createKeywordsCollection()
#Matches keywords for each professor listing (make sure to create keywords bank with generate_keywords.py)
matchKeywords(inputFile = 'data/professor_listings.csv', verbose = True)

#fix two word "one-word keywords" later, or figure out how to process them in search as one word