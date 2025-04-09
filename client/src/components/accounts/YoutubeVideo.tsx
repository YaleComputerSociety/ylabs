function YoutubeVideo() {
    return (
        <div >
            <iframe className="w-[200px] h-[112.5px] sm:w-[400px] sm:h-[225px] lg:w-[800px] lg:h-[450px] transition-all" src="https://www.youtube.com/embed/Crf3Tyjsk2k?si=eXHPqMv_Fwi04FT4" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen></iframe>
        </div>
    )
}

export default YoutubeVideo;