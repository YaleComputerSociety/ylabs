import React, {useState} from "react";
import ListingsTable from "../components/ListingsTable";
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Autocomplete from '@mui/material/Autocomplete';
import Stack from '@mui/material/Stack';
 
const Home = () => {
    const [lastNamePI, setLastNamePI] = useState("");
    const [keywords, setKeywords] = useState("");
    const [lastDepartment, setLastDepartment] = useState("");
    const [departments, setDepartments] = useState<string[]>([]); 

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => { 
        event.preventDefault();
        console.log(departments);
        console.log(lastNamePI, keywords, departments);
    }

    return (
        <div>
            <h5>Buffer</h5>
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
            <ListingsTable></ListingsTable>
        </div>
    );
};

const departmentNames = [
    "African American Studies",
    "African Studies",
    "American Studies",
    "Anesthesiology",
    "Anthropology",
    "Applied Mathematics",
    "Applied Physics",
    "Archaeological Studies",
    "Architecture",
    "Art",
    "Astronomy",
    "Biological and Biomedical Sciences",
    "Biomedical Engineering",
    "Biostatistics",
    "Cell Biology",
    "Cellular and Molecular Physiology",
    "Chemical and Environmental Engineering",
    "Chemistry",
    "Child Study Center",
    "Chronic Disease Epidemiology",
    "Classics",
    "Cognitive Science",
    "Comparative Literature",
    "Comparative Medicine",
    "Computational Biology and Bioinformatics",
    "Computer Science",
    "Dermatology",
    "Early Modern Studies",
    "Earth and Planetary Sciences",
    "East Asian Languages and Literatures",
    "East Asian Studies",
    "Ecology and Evolutionary Biology",
    "Economics",
    "Electrical Engineering",
    "Emergency medicine",
    "Engineering and Applied Science",
    "English",
    "Environmental Health Sciences",
    "Environmental Studies",
    "Epidemiology of Microbial Diseases",
    "Ethics, Politics and Economics",
    "Ethnicity, Race and Migration",
    "European and Russian Studies",
    "Experimental Pathology",
    "Film and Media Studies",
    "Forestry and Environmental Studies",
    "French",
    "Genetics",
    "Geology and Geophysics",
    "German",
    "Global Affairs",
    "Health Care Management",
    "Health Policy and Management",
    "Hellenic Studies",
    "History",
    "History of Art",
    "History of Medicine",
    "History of Science and Medicine",
    "Humanities",
    "Immunobiology",
    "Internal Medicine",
    "International and Development Economics",
    "Investigative Medicine",
    "Italian",
    "Judaic Studies",
    "Laboratory Medicine",
    "Latin American Studies",
    "Law",
    "Linguistics",
    "MCDB",
    "Management",
    "Mathematics",
    "Mechanical Engineering and Materials Science",
    "Medicine",
    "Medieval Studies",
    "Microbial Pathogenesis",
    "Microbiology",
    "Modern Middle East Studies",
    "Molecular Biophysics and Biochemistry",
    "Molecular, Cellular and Developmental Biology",
    "Music",
    "Near Eastern Langauges and Civilizations",
    "Neurology",
    "Neuroscience",
    "Neurosurgery",
    "Nursing",
    "Obstetrics, Gynecology and Reproductive Sciences",
    "Ophthalmology and Visual Science",
    "Orthopaedics and Rehabilitation",
    "Pathology",
    "Pediatrics",
    "Pharmacology",
    "Philosophy",
    "Physics",
    "Political Science",
    "Psychiatry",
    "Psychology",
    "Public Health",
    "Radiology and Biomedical Imaging",
    "Religious Studies",
    "Slavic Languages and Literatures",
    "Sociology",
    "South Asian Studies",
    "Spanish and Portuguese",
    "Statistics",
    "Surgery",
    "Theater Studies",
    "Therapeutic Radiology",
    "Urology",
    "Women’s, Gender, and Sexuality Studies",
  ];

export default Home;