import React, {useState} from "react";
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Autocomplete from '@mui/material/Autocomplete';
import Stack from '@mui/material/Stack';
import {Listing} from '../types/types';
import {departmentNames} from '../utils/departmentNames'; 
 
type SearchProps = {
  setListings: (listings: Listing[]) => void;
}

function createListing(
  id: number,
  departments: string,
  email: string,
  website: string,
  description: string,
  keywords: string,
  lastUpdated: string,
  name: string,
): Listing {
  return {
    id,
    departments,
    email,
    website,
    description,
    keywords,
    lastUpdated,
    name
  };
}

export const sampleListings = [
  createListing(5, 'American Studies, African American Studies', 'test@yale.edu', 'www.yale.edu', 'description', 'keyword', '2017-09-29 19:27:48', 'John Doe'),
  createListing(6, 'English', 'test@yale.edu', 'www.yale.edu', 'description2', 'keyword2', '2016-09-29 19:27:48', 'Jane Doe'),
];

export default function Search(props: SearchProps) {
    const {setListings} = props;
    const [lastNamePI, setLastNamePI] = useState("");
    const [keywords, setKeywords] = useState("");
    const [departments, setDepartments] = useState<string[]>([]); 

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => { 
      event.preventDefault();
      console.log(lastNamePI, keywords, departments);
      setListings(sampleListings);
    }

    return (
      <form onSubmit={handleSubmit} noValidate>     
          <Stack direction="row" justifyContent="space-around" alignItems="flex-start" spacing={1.5}>
                  <Autocomplete
                      multiple
                      limitTags={2}
                      id="tags-outlined"
                      options={departmentNames}
                      onChange={(event, newDept) => {
                          setDepartments(newDept);
                      }}
                      getOptionLabel={(option) => option}
                      sx={{width: '700px'}}
                      renderInput={(params) => (
                      <TextField
                          {...params}
                          required
                          label="Departments"
                          placeholder=""
                      />
                      )}
                  />
                  <TextField 
                      id="professor-search" 
                      label="PI Last Name" 
                      onChange={e => setLastNamePI(e.target.value)} 
                      type="search" 
                      sx={{width: '350px'}}/>
                  <TextField 
                      id="keyword-search" 
                      label="Keyword(s) (comma-separated)" 
                      onChange={e => setKeywords(e.target.value)} 
                      type="search" 
                      sx={{width: '350px'}}/>
                  <Button
                      type="submit"
                      sx={{paddingTop: '15px'}}
                  >
                      Search</Button>
          </Stack>
      </form>   
    );
};