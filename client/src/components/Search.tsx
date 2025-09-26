import React, {useState} from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Autocomplete from '@mui/material/Autocomplete';
import Stack from '@mui/material/Stack';
import {Listing} from '../types/types';
import {departmentNames} from '../utils/departmentNames'; 
import axios from 'axios';
import swal from "sweetalert";
 
type SearchProps = {
  setListings: (listings: Listing[]) => void;
  setIsLoading: (isLoading: Boolean) => void;
  numSearches: number;
  setNumSearches: (searches: number) => void;
}

export default function Search(props: SearchProps) {
    const {setListings, setIsLoading, numSearches, setNumSearches} = props;
    const [lastNamePI, setLastNamePI] = useState('');
    const [keywords, setKeywords] = useState('');
    const [departments, setDepartments] = useState<string[]>([]); 

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => { 
      event.preventDefault();
      if(departments.length === 0 && keywords === '' && lastNamePI === ''){
        swal({
          text: "Please fill out at least one field.",
          icon: "warning",
        })
        setIsLoading(false); 
        return;
      }
      setIsLoading(true); 
      const backendBaseURL = window.location.host.includes("yalelabs.io")
        ? "https://yalelabs.io"
        : import.meta.env.VITE_APP_SERVER;
      const url = backendBaseURL + '/listings?dept=' + departments 
                  + '&keywords=' + keywords + '&lname=' + lastNamePI;
      axios.get(url).then((response) => {
        const responseListings : Listing[] = response.data.map(function(elem: any){
            return {
              id: elem._id,
              departments: elem.departments.join('; '),
              email: elem.email,
              website: elem.website,
              description: elem.description,
              keywords: elem.keywords,
              lastUpdated: elem.last_updated,
              name: elem.fname + ' ' + elem.lname
            }
        })
        setListings(responseListings);
        setNumSearches(numSearches + 1);
        setIsLoading(false); 
      });
    }

    return (
      <div>
        <form onSubmit={handleSubmit} noValidate>     
            <Stack direction='row' justifyContent='space-around' alignItems='flex-start' spacing={1.5}>
                    <Autocomplete
                        multiple
                        limitTags={2}
                        id='tags-outlined'
                        options={departmentNames}
                        onChange={(event, newDept) => {
                            setDepartments(newDept);
                        }}
                        getOptionLabel={(option) => option}
                        sx={{width: '700px'}}
                        renderInput={(params) => (
                        <TextField
                            {...params}
                            label='Departments'
                            placeholder=''
                        />
                        )}
                    />
                    <TextField 
                        id='professor-search' 
                        label='PI Last Name' 
                        onChange={e => setLastNamePI(e.target.value)} 
                        type='search' 
                        sx={{width: '350px'}}/>
                    <TextField 
                        id='keyword-search' 
                        label='Keyword(s) (comma-separated)' 
                        onChange={e => setKeywords(e.target.value)} 
                        type='search' 
                        sx={{width: '350px'}}/>
                    <Button
                        type='submit'
                        sx={{paddingTop: '15px'}}
                    >
                        Search</Button>
            </Stack>
        </form>   
      </div>
    );
};