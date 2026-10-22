import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const TEXT_MODEL = 'Xenova/trocr-base-handwritten';
const MATH_MODEL = 'Xenova/texify';

let textRecognizerPromise = null;
let mathRecognizerPromise = null;

// Track download progress per file to prevent UI bouncing
const fileProgress = {};

const progress_callback = (data) => {
    if (data.status === 'initiate') {
        fileProgress[data.file] = 0;
    } else if (data.status === 'progress') {
        fileProgress[data.file] = data.progress;
        
        const progresses = Object.values(fileProgress);
        const overallProgress = progresses.reduce((sum, p) => sum + p, 0) / progresses.length;

        self.postMessage({ 
            status: 'downloading', 
            file: 'Model files', 
            progress: overallProgress 
        });
    } else if (data.status === 'done') {
        fileProgress[data.file] = 100;
    }
};

self.addEventListener('message', async (event) => {
    const { type, image_url, mode } = event.data;

    if (type === 'init') {
        if (mode === 'text') {
            if (!textRecognizerPromise) {
                // webgpu natively supports fp16, WASM does not
                textRecognizerPromise = pipeline('image-to-text', TEXT_MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback });
            }
            await textRecognizerPromise;
        } else if (mode === 'math') {
            if (!mathRecognizerPromise) {
                mathRecognizerPromise = pipeline('image-to-text', MATH_MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback });
            }
            await mathRecognizerPromise;
        }
        self.postMessage({ status: 'ready', message: 'Model loaded and ready.' });
        return;
    }

    if (type === 'recognize') {
        try {
            if (mode === 'text') {
                if (!textRecognizerPromise) {
                    textRecognizerPromise = pipeline('image-to-text', TEXT_MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback });
                }
                
                self.postMessage({ status: 'loading', message: 'Loading text engine...' });
                const textRecognizer = await textRecognizerPromise;

                if (Array.isArray(image_url)) {
                    const results = [];
                    for (let i = 0; i < image_url.length; i++) {
                        self.postMessage({ status: 'processing', message: `Reading line ${i + 1} of ${image_url.length}...` });
                        const output = await textRecognizer(image_url[i]);
                        const text = output[0].generated_text.trim();
                        if (text) results.push(text);
                    }
                    self.postMessage({ status: 'complete', result: results.join('\n'), mode: mode });
                    return;
                }

                self.postMessage({ status: 'processing', message: 'Reading handwriting...' });
                const output = await textRecognizer(image_url);
                self.postMessage({ status: 'complete', result: output[0].generated_text, mode: mode });

            } else if (mode === 'math') {
                if (!mathRecognizerPromise) {
                    mathRecognizerPromise = pipeline('image-to-text', MATH_MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback });
                }
                
                self.postMessage({ status: 'loading', message: 'Loading math engine...' });
                const mathRecognizer = await mathRecognizerPromise;
                
                self.postMessage({ status: 'processing', message: 'Analyzing formula...' });
                const output = await mathRecognizer(image_url);
                self.postMessage({ status: 'complete', result: output[0].generated_text, mode: mode });
            }
        } catch (error) {
            console.error(error);
            self.postMessage({ status: 'complete', result: 'Error: Failed to process.', mode: mode });
        }
    }
});