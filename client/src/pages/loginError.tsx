import swal from 'sweetalert';
import {useEffect, useState} from 'react';

const LoginError = () => {
    const [showError, setShowError] = useState(false);
    
    useEffect(() => {
        const timeout = setTimeout(() => {
            setShowError(true);
        }, 500);
    });

    useEffect(() => {
        if(showError) {
            swal({
                text: "We were unable to process your login. Please try again or contact support if the issue persists.",
                icon: "warning",
            }).then(() => {
                window.location.href = '/login';
            });
        }
    }, [showError]);
    
    return null;
}

export default LoginError;