import os
import uuid
import re
from llama_cpp import Llama
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

def generateKeywordsTxt(filename = 'keywords_bank.txt'):
    departmentsPath = os.path.join('..', 'valid_departments.txt')

    with open(departmentsPath, 'r') as file:
        validDepartments = file.read().split('\n')

    llm = Llama(
        model_path = 'MODEL PATH HERE',
        n_ctx = 2048,
        verbose = False
    )

    with open(filename, 'w') as file:
        keywordsBank = []
        
        for department in validDepartments:
            output = llm.create_chat_completion(
                messages = [{"role": "system", "content": "When asked for a python list of strings, return just the list of strings in square brackets and absolutely nothing else.\nExample: Give a python list of strings of 5 fruits\nResponse: ['apple', 'pear', 'orange', 'grape', 'plum']"}, {"role": "user", "content": f"Give me a python list of strings of 10 lowercase, one-word keywords related to {department} research\nPython list of strings: "}]
            )['choices'][0]['message']['content']

            output = re.sub(r"[\"'\[\]`]", '', output)
            if re.search(r"[;\n()*&^%$#@!~{}|]", output):
                print(output)
                input("Continue?")

            keywords = output.split(', ')
            for keyword in keywords:
                keywordsBank.append(keyword)

        keywordsBank = list(set(keywordsBank))

        for keyword in keywordsBank:
            file.write(keyword + '\n')

def createKeywordsCollection(filename = 'keywords_bank.txt'):
    client = QdrantClient(path = 'embeddings')

    #embeddings model
    llm = Llama(
        model_path = 'MODEL PATH HERE',
        embedding = True,
        verbose = False
    )

    if(client.collection_exists('keywords')):
        client.delete_collection('keywords')
        print('Deleted exitsting keywords collection')
    
    with open(filename, 'r') as file:
        keywordsBank = file.read().split('\n')
    
    keywords_embeddings = [(keyword, llm.create_embedding(keyword)['data'][0]['embedding']) for keyword in keywordsBank]

    client.create_collection(
        collection_name = 'keywords',
        vectors_config = VectorParams(size = 1024, distance = Distance.COSINE)
    )

    points = [
        PointStruct(
            id = str(uuid.uuid4()),
            vector = embeddings,
            payload = {
                "text": keyword
            }
        )
        for keyword, embeddings in keywords_embeddings
    ]

    operation_info = client.upsert(
        collection_name = 'keywords',
        wait = True,
        points = points
    )