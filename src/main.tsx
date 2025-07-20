import { render } from 'preact';
import { useState, useContext, useRef, useEffect } from 'preact/hooks';
import { createContext } from 'preact';
import {
    Typography, Box, Paper, CssBaseline,
    AppBar, Toolbar,
    TextField, Button, MenuItem,
    Card, CardContent
} from '@mui/material';
import { ThemeProvider, createTheme, useTheme } from '@mui/material/styles';
import ReactMarkdown from 'react-markdown';

import 'normalize.css';
import type React from 'preact/compat';

// AppContext for global state
interface AppContextType {
    apiKey: string;
    setApiKey: (key: string) => void;
    geminiVersion: string;
    setGeminiVersion: (v: string) => void;
    imageModelVersion: string;
    setImageModelVersion: (v: string) => void;
    refinedPrompt: string;
    setRefinedPrompt: (prompt: string) => void;
    apiRequestsPerSecond: number;
    domainQuestions: Array<string>;
    setDomainQuestions: (questions: Array<string>) => void;
    domainAnswers: Record<string, string>;
    setDomainAnswers: (answers: Record<string, string>) => void;
    articleLayout: string;
    setArticleLayout: (layout: string) => void;
}
const AppContext = createContext<AppContextType>({
    apiKey: '', setApiKey: () => { },
    geminiVersion: 'gemini-pro', setGeminiVersion: () => { },
    imageModelVersion: '', setImageModelVersion: () => { },
    refinedPrompt: '', setRefinedPrompt: () => { },
    apiRequestsPerSecond: 0,
    domainQuestions: [], setDomainQuestions: () => { },
    domainAnswers: {}, setDomainAnswers: () => { },
    articleLayout: '', setArticleLayout: () => { },
});

// --- API Request Handler ---
let apiRequestTimestamps: number[] = [];
let apiRequestQueue: Array<() => void> = [];
let apiRequestsPerSecondGlobal = 0;

function updateApiRequestsPerSecond() {
    const now = Date.now();
    // Remove timestamps older than 1 second
    apiRequestTimestamps = apiRequestTimestamps.filter(ts => now - ts < 1000);
    apiRequestsPerSecondGlobal = apiRequestTimestamps.length;
}

function apiRequestHandler<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const tryRequest = () => {
            updateApiRequestsPerSecond();
            if (apiRequestsPerSecondGlobal < 1) {
                apiRequestTimestamps.push(Date.now());
                updateApiRequestsPerSecond();
                fn().then(resolve).catch(reject);
                // After request, process next in queue if any
                setTimeout(() => {
                    updateApiRequestsPerSecond();
                    if (apiRequestQueue.length > 0) {
                        const next = apiRequestQueue.shift();
                        if (next) next();
                    }
                }, 1000);
            } else {
                // Enqueue and try again after 100ms
                apiRequestQueue.push(() => tryRequest());
                setTimeout(() => {
                    if (apiRequestQueue.length > 0 && apiRequestsPerSecondGlobal < 1) {
                        const next = apiRequestQueue.shift();
                        if (next) next();
                    }
                }, 100);
            }
        };
        tryRequest();
    });
}

// Toast Context
interface Toast {
    id: number;
    message: string;
    severity?: 'success' | 'error' | 'info' | 'warning';
}
interface ToastContextType {
    addToast: (msg: string, severity?: Toast['severity']) => void;
}
const ToastContext = createContext<ToastContextType>({
    addToast: () => { },
});

function ToastPool({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: number) => void }) {
    const theme = useTheme();

    function getToastStyle(severity?: Toast['severity']) {
        switch (severity) {
            case 'error':
                return {
                    backgroundColor: theme.palette.error.main, color: theme.palette.error.contrastText
                };
            case 'success':
                return {
                    backgroundColor: theme.palette.success.main, color: theme.palette.success.contrastText
                };
            case 'info':
                return {
                    backgroundColor: theme.palette.info.main, color: theme.palette.info.contrastText
                };
            case 'warning':
                return {
                    backgroundColor: theme.palette.warning.main, color: theme.palette.warning.contrastText
                };
            default:
                return {
                    backgroundColor: theme.palette.primary.main, color: theme.palette.primary.contrastText
                };
        }
    }

    return (
        <Box sx={{ position: 'fixed', bottom: 16, left: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {toasts.map(t => (
                <Paper key={t.id} elevation={6} sx={{ p: 2, minWidth: 200, backgroundColor: getToastStyle(t.severity), color: '#fff' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>{t.message}</span>
                        <Button sx={{ color: '#fff', ml: 1, minWidth: 0 }} onClick={() => removeToast(t.id)}>×</Button>
                    </Box>
                </Paper>
            ))}
        </Box>
    );
}


// Common types
interface UsageStats {
    inputLength?: number;
    outputLength?: number;
    timeTaken?: number;
}

interface PromptApproval {
    suggestedPrompt: string;
    onApproval: (modifiedPrompt: string) => void;
    processed?: boolean;
    response?: string;
}

type WorkspaceComponentType = React.FC<{
    setUsageStats: (stats: UsageStats) => void;
    setApprovalRequest: (approval: PromptApproval | undefined) => void;
    completed: boolean;
    onComplete: () => void;
    onRetry: () => void;
}>;


interface StepProps {
    WorkspaceComponent: WorkspaceComponentType;
    completed: boolean;
    onComplete: () => void;
    onRetry: () => void;
}

const Step = ({ WorkspaceComponent, completed, onComplete, onRetry }: StepProps) => {
    const [usageStats, setUsageStats] = useState<UsageStats | undefined>(undefined);
    const [approvalRequest, setApprovalRequest] = useState<PromptApproval | undefined>(undefined);
    const [localPrompt, setLocalPrompt] = useState(approvalRequest ? approvalRequest.suggestedPrompt : '');

    // Update localPrompt when approvalRequest changes
    useEffect(() => {
        setLocalPrompt(approvalRequest ? approvalRequest.suggestedPrompt : '');
    }, [approvalRequest]);

    // Step completion is now controlled by the workspace component via onComplete

    return (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', opacity: completed ? 0.6 : 1 }}>
            {/* Usage Stats Card */}
            <Card elevation={2} sx={{ flex: 1, width: '10%' }}>
                <CardContent>
                    {
                        usageStats ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                <Typography variant="subtitle2" color="text.secondary">Usage Stats</Typography>
                                <Typography variant="body2">Input: {usageStats.inputLength ?? '-'}</Typography>
                                <Typography variant="body2">Output: {usageStats.outputLength ?? '-'}</Typography>
                                <Typography variant="body2">Time: {usageStats.timeTaken ?? '-'}s</Typography>
                            </Box>
                        ) : <Box sx={{ minHeight: 24 }}></Box>
                    }
                </CardContent>
            </Card>
            {/* Workspace Card */}
            <Card elevation={2} sx={{ width: '50%' }}>
                <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <WorkspaceComponent
                            setUsageStats={setUsageStats}
                            setApprovalRequest={setApprovalRequest}
                            completed={completed}
                            onComplete={onComplete}
                            onRetry={onRetry}
                        />
                    </Box>
                </CardContent>
            </Card>
            {/* Approval Card */}
            <Card elevation={2} sx={{ width: '40%' }}>
                <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        {approvalRequest ? (
                            approvalRequest.processed ? (
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    <Typography variant="subtitle2" color="text.secondary">Prompt</Typography>
                                    <ReactMarkdown>{approvalRequest.suggestedPrompt}</ReactMarkdown>
                                    <Typography variant="subtitle2" color="text.secondary">Response</Typography>
                                    <ReactMarkdown>{approvalRequest.response || ''}</ReactMarkdown>
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
                                    <TextField
                                        value={localPrompt}
                                        onChange={e => setLocalPrompt((e.target as HTMLInputElement).value)}
                                        label="Modify prompt"
                                        variant="outlined"
                                        multiline
                                        minRows={5}
                                        maxRows={12}
                                        fullWidth
                                    />
                                    <Button
                                        variant="contained"
                                        onClick={() => approvalRequest.onApproval(localPrompt)}
                                    >Approve prompt</Button>
                                </Box>
                            )
                        ) : <Box sx={{ minHeight: 24 }}></Box>}
                    </Box>
                </CardContent>
            </Card>
        </Box >
    );
}

// Common Submit/Rerun Buttons component
interface SubmitRerunButtonsProps {
    onSubmit: () => void;
    onRerun: () => void;
    submitDisabled?: boolean;
    rerunVisible?: boolean;
    rerunDisabled?: boolean;
    submitLabel?: string;
    rerunLabel?: string;
}

function SubmitRerunButtons({
    onSubmit,
    onRerun,
    submitDisabled = false,
    rerunVisible = false,
    rerunDisabled = false,
    submitLabel = 'Submit',
    rerunLabel = 'Rerun',
}: SubmitRerunButtonsProps) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, mt: 1 }}>
            <Button
                variant="contained"
                onClick={onSubmit}
                disabled={submitDisabled}
            >{submitLabel}</Button>
            {rerunVisible && (
                <Button
                    variant="outlined"
                    color="warning"
                    onClick={onRerun}
                    disabled={rerunDisabled}
                >{rerunLabel}</Button>
            )}
        </Box>
    );
}

// ApiKeyWorkspace component
const ApiKeyWorkspace: WorkspaceComponentType = ({ completed, onComplete, onRetry }) => {
    const { apiKey, setApiKey } = useContext(AppContext);
    const { addToast } = useContext(ToastContext);
    const [localKey, setLocalKey] = useState(apiKey);
    const handleSubmit = () => {
        setApiKey(localKey);
        addToast('API Key updated!', 'success');
        if (!completed) onComplete();
    };
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
            <TextField
                type="password"
                value={localKey}
                onChange={e => setLocalKey((e.target as HTMLInputElement).value)}
                label="API Key"
                variant="outlined"
                fullWidth
            />
            <SubmitRerunButtons
                onSubmit={handleSubmit}
                onRerun={onRetry}
                submitDisabled={!localKey || completed}
                rerunVisible={completed}
                rerunDisabled={false}
                submitLabel="Submit"
                rerunLabel="Rerun"
            />
        </Box>
    );
};

// InitialPromptWorkspace component
const InitialPromptWorkspace: WorkspaceComponentType = ({ setUsageStats, setApprovalRequest, completed, onComplete, onRetry }) => {
    const [localPrompt, setLocalPrompt] = useState('');
    const { apiKey, geminiVersion, setRefinedPrompt } = useContext(AppContext);
    const { addToast } = useContext(ToastContext);

    async function onApproval(modifiedPrompt: string) {
        const beginTime = performance.now();
        setUsageStats({ inputLength: modifiedPrompt.length });
        setApprovalRequest({
            suggestedPrompt: modifiedPrompt,
            onApproval,
            processed: true,
            response: 'Awaiting response...',
        });

        try {
            addToast('Submitting prompt for processing...', 'info');
            const response = await promptProcessor(apiKey, geminiVersion, modifiedPrompt);

            const endTime = performance.now();
            const timeTaken = (endTime - beginTime) / 1000;

            addToast('Prompt processed successfully!', 'success');
            setUsageStats({
                inputLength: modifiedPrompt.length,
                outputLength: response.length,
                timeTaken: timeTaken,
            });
            setApprovalRequest({
                suggestedPrompt: modifiedPrompt,
                onApproval,
                processed: true,
                response,
            });
            setRefinedPrompt(response);
            if (!completed) onComplete();
        } catch (err: any) {
            const endTime = performance.now();
            const timeTaken = (endTime - beginTime) / 1000;

            addToast('Error processing prompt: ' + (err?.message || 'Unknown error'), 'error');

            setUsageStats({
                inputLength: modifiedPrompt.length,
                timeTaken: timeTaken,
            });
            setApprovalRequest({
                suggestedPrompt: modifiedPrompt,
                onApproval,
                processed: true,
                response: 'Error: ' + (err?.message || 'Unknown error'),
            });
            setRefinedPrompt('');
            if (!completed) onComplete();
        }
    };

    function handleSubmit() {
        setApprovalRequest({
            suggestedPrompt: `Provided the prompt, refine it into a descriptive topic for an article, focusing on clarity and content generation potential, while keeping it simple, short, and avoiding options or variants.\n"${localPrompt}"`,
            onApproval,
            processed: false,
            response: '',
        });
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
            <TextField
                value={localPrompt}
                onChange={e => setLocalPrompt((e.target as HTMLInputElement).value)}
                label="Initial Prompt"
                variant="outlined"
                multiline
                minRows={5}
                maxRows={12}
                fullWidth
            />
            <SubmitRerunButtons
                onSubmit={handleSubmit}
                onRerun={onRetry}
                submitDisabled={completed}
                rerunVisible={completed}
                rerunDisabled={false}
                submitLabel="Submit"
                rerunLabel="Rerun"
            />
        </Box>
    );
};

// DomainQueryWorkspace component
const DomainQueryWorkspace: WorkspaceComponentType = ({ setUsageStats, setApprovalRequest, completed, onComplete, onRetry }) => {
    const { apiKey, geminiVersion, refinedPrompt, setDomainQuestions, setDomainAnswers } = useContext(AppContext);
    const { addToast } = useContext(ToastContext);
    const [questions, setQuestions] = useState<Array<string> | null>(null);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Request domain questions from AI when refinedPrompt changes
    useEffect(() => {
        if (!refinedPrompt || questions || completed) return;
        setLoading(true);
        setError(null);
        const prompt = `Given the topic: "${refinedPrompt}", generate a list of domain-related questions to ask the user to understand their context. Respond strictly in JSON format as an array of strings.`;
        setUsageStats({ inputLength: prompt.length });
        setApprovalRequest({
            suggestedPrompt: prompt,
            onApproval: async (approvedPrompt: string) => {
                setApprovalRequest({
                    suggestedPrompt: approvedPrompt,
                    onApproval: () => { },
                    processed: true,
                    response: 'Awaiting response...',
                })

                try {
                    const beginTime = performance.now();
                    addToast('Requesting domain questions...', 'info');
                    setUsageStats({ inputLength: approvedPrompt.length });
                    const response = await promptProcessor(apiKey, geminiVersion, approvedPrompt);
                    const endTime = performance.now();
                    const timeTaken = (endTime - beginTime) / 1000;
                    setUsageStats({ inputLength: approvedPrompt.length, outputLength: response.length, timeTaken });
                    // Try to extract JSON from response
                    let jsonMatch = response.match(/\[.*\]/s);
                    let parsed: Array<string> = [];
                    if (jsonMatch) {
                        try {
                            parsed = JSON.parse(jsonMatch[0]);
                        } catch (e) {
                            setError('Failed to parse JSON from AI response.');
                        }
                    } else {
                        setError('No JSON found in AI response.');
                    }
                    setQuestions(parsed);
                    setDomainQuestions(parsed);
                    setApprovalRequest({
                        suggestedPrompt: approvedPrompt,
                        onApproval: () => { },
                        processed: true,
                        response,
                    });
                } catch (err: any) {
                    setError(err?.message || 'Unknown error');
                    addToast('Error: ' + (err?.message || 'Unknown error'), 'error');
                } finally {
                    setLoading(false);
                }
            },
            processed: false,
            response: '',
        });
    }, [refinedPrompt, completed]);

    // Handle user answers
    function handleAnswerChange(idx: number, value: string) {
        setAnswers(prev => ({ ...prev, [String(idx)]: value }));
    }

    function handleSubmitAnswers() {
        setDomainQuestions(questions || []);
        setDomainAnswers(answers);
        if (!completed) onComplete();
    }

    // UI rendering
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {loading && <Typography>Loading domain questions...</Typography>}
            {error && <Typography color="error">{error}</Typography>}
            {!questions && !loading && !error && (
                <Typography>Waiting for domain questions...</Typography>
            )}
            {questions && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="subtitle2">Please answer the following questions:</Typography>
                    {questions.map((q, idx) => (
                        <Box key={idx} sx={{ mb: 2 }}>
                            <Typography variant="body1">{q}</Typography>
                            <TextField
                                value={answers[String(idx)] || ''}
                                onChange={e => handleAnswerChange(idx, (e.target as HTMLInputElement).value)}
                                label="Your answer"
                                fullWidth
                            />
                        </Box>
                    ))}
                    <SubmitRerunButtons
                        onSubmit={handleSubmitAnswers}
                        onRerun={onRetry}
                        submitDisabled={completed || Object.keys(answers).length !== questions.length}
                        rerunVisible={completed}
                        rerunDisabled={false}
                        submitLabel="Submit Answers"
                        rerunLabel="Rerun"
                    />
                </Box>
            )}
        </Box>
    );
};

// ArticleLayoutWorkspace component
const ArticleLayoutWorkspace: WorkspaceComponentType = ({ setUsageStats, setApprovalRequest, completed, onComplete, onRetry }) => {
    const { apiKey, geminiVersion, refinedPrompt, domainQuestions, domainAnswers, setArticleLayout } = useContext(AppContext);
    const { addToast } = useContext(ToastContext);
    const [layout, setLayout] = useState('');
    const [editableLayout, setEditableLayout] = useState('');
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (completed || !refinedPrompt || !domainQuestions.length || Object.keys(domainAnswers).length !== domainQuestions.length) return;
        // Compose layout prompt
        const questionsAndAnswers = domainQuestions.map((q, idx) => `Q${idx + 1}: ${q}\nA${idx + 1}: ${domainAnswers[String(idx)] || ''}`).join('\n');
        const layoutPrompt = `Given the topic: "${refinedPrompt}", and the following user context:\n${questionsAndAnswers}\nGenerate a detailed article layout (headings, sections, and brief descriptions) suitable for an in-depth article. Respond in Markdown.`;
        setUsageStats({ inputLength: layoutPrompt.length });
        setApprovalRequest({
            suggestedPrompt: layoutPrompt,
            onApproval: async (approvedPrompt) => {
                setApprovalRequest({
                    suggestedPrompt: approvedPrompt,
                    onApproval: () => { },
                    processed: true,
                    response: 'Awaiting response...',
                });

                try {
                    addToast('Requesting article layout...', 'info');
                    const beginTime = performance.now();
                    const response = await promptProcessor(apiKey, geminiVersion, approvedPrompt);
                    const endTime = performance.now();
                    const timeTaken = (endTime - beginTime) / 1000;
                    setUsageStats({ inputLength: approvedPrompt.length, outputLength: response.length, timeTaken });
                    setLayout(response);
                    setEditableLayout(response);
                    setEditing(false);
                    setApprovalRequest({
                        suggestedPrompt: approvedPrompt,
                        onApproval: () => { },
                        processed: true,
                        response,
                    });
                } catch (err: any) {
                    setError(err?.message || 'Unknown error');
                    addToast('Error: ' + (err?.message || 'Unknown error'), 'error');
                }
            },
            processed: false,
            response: '',
        });
    }, [refinedPrompt, domainQuestions, domainAnswers, completed]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">Article Layout</Typography>
            {error && <Typography color="error">{error}</Typography>}
            {layout && !editing && (
                <Box>
                    <ReactMarkdown>{editableLayout}</ReactMarkdown>
                    <Button sx={{ mt: 2 }} variant="outlined" onClick={() => setEditing(true)}>
                        Modify Layout
                    </Button>
                </Box>
            )}
            {layout && editing && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <TextField
                        label="Edit Article Layout (Markdown)"
                        multiline
                        minRows={8}
                        maxRows={24}
                        value={editableLayout}
                        onChange={e => setEditableLayout((e.target as HTMLInputElement).value)}
                        fullWidth
                    />
                    <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1 }}>
                        <Button variant="contained" onClick={() => { setLayout(editableLayout); setEditing(false); addToast('Layout updated!', 'success'); }}>Preview</Button>
                        <Button variant="outlined" color="warning" onClick={() => { setEditableLayout(layout); setEditing(false); }}>Cancel</Button>
                    </Box>
                </Box>
            )}
            {!layout && !error && (
                <Typography>Waiting for layout generation...</Typography>
            )}
            <SubmitRerunButtons
                onSubmit={() => { setArticleLayout(layout); if (!completed) onComplete(); }}
                onRerun={onRetry}
                submitDisabled={!layout || completed}
                rerunVisible={completed}
                rerunDisabled={false}
                submitLabel="Save & Next"
                rerunLabel="Rerun"
            />
        </Box>
    );
};

// VisualSuggestionWorkspace: new step for AI-driven visual suggestions for article sections
const VisualSuggestionWorkspace: WorkspaceComponentType = ({ setUsageStats, setApprovalRequest, completed, onComplete, onRetry }) => {
    const { apiKey, geminiVersion, articleLayout, imageModelVersion } = useContext(AppContext);
    const { addToast } = useContext(ToastContext);
    const [sectionPrompts, setSectionPrompts] = useState<string[]>([]);
    const [visualSuggestions, setVisualSuggestions] = useState<string[]>([]);
    const [approvedPrompts, setApprovedPrompts] = useState<string[]>([]);
    const [images, setImages] = useState<string[]>([]);
    const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
    const [error, setError] = useState('');

    // Split articleLayout into sections (by headings)
    useEffect(() => {
        if (!articleLayout) return;
        // Simple split by Markdown headings
        const sections = articleLayout.split(/\n(?=#+ )/).filter(Boolean);
        setSectionPrompts(sections.map((section) => `Suggest a contextually relevant visual for the following article section. Respond with a short image description and style suggestion.\nSection:\n${section}`));
        setVisualSuggestions(Array(sections.length).fill(''));
        setApprovedPrompts(Array(sections.length).fill(''));
    }, [articleLayout]);

    // Handler to request AI suggestion for a section
    const handleSuggest = async (idx: number) => {
        setLoadingIdx(idx);
        setError('');
        setUsageStats({ inputLength: sectionPrompts[idx].length });
        setApprovalRequest({
            suggestedPrompt: sectionPrompts[idx],
            onApproval: async (approvedPrompt: string) => {
                setApprovalRequest({
                    suggestedPrompt: approvedPrompt,
                    onApproval: () => { },
                    processed: true,
                    response: 'Awaiting response...',
                });
                try {
                    addToast('Requesting visual suggestion...', 'info');
                    const beginTime = performance.now();
                    const response = await promptProcessor(apiKey, geminiVersion, approvedPrompt);
                    const endTime = performance.now();
                    const timeTaken = (endTime - beginTime) / 1000;
                    setUsageStats({ inputLength: approvedPrompt.length, outputLength: response.length, timeTaken });
                    setApprovalRequest({
                        suggestedPrompt: approvedPrompt,
                        onApproval: () => { },
                        processed: true,
                        response,
                    });

                    setVisualSuggestions(prev => prev.map((v, i) => i === idx ? response : v));
                    setApprovedPrompts(prev => prev.map((p, i) => i === idx ? approvedPrompt : p));
                    addToast('Visual suggestion generated!', 'success');

                    // Request image from Gemini using the suggestion as prompt
                    addToast('Generating image...', 'info');
                    let imageUrl = '';
                    try {
                        if (!imageModelVersion) {
                            throw new Error('No image model selected.');
                        }
                        imageUrl = await imageGeneration(apiKey, imageModelVersion, response);
                        if (imageUrl) {
                            addToast('Image generated successfully!', 'success');
                        } else {
                            throw new Error('Image generation returned no URL.');
                        }
                    } catch (imgErr: any) {
                        if (imgErr?.message?.includes('unsupported') || imgErr?.message?.includes('not supported')) {
                            setError('Image generation failed: Model does not support image generation.');
                            addToast('Image generation failed: Model does not support image generation.', 'error');
                        } else {
                            setError('Image generation error: ' + (imgErr?.message || 'Unknown error'));
                            addToast('Image generation error: ' + (imgErr?.message || 'Unknown error'), 'error');
                        }
                        imageUrl = 'https://placehold.co/400x200?text=Image+Error';
                    }
                    setImages(prev => {
                        const newImages = [...prev];
                        newImages[idx] = imageUrl;
                        return newImages;
                    });
                } catch (err: any) {
                    setError('Error: ' + (err?.message || 'Unknown error'));
                    addToast('Error generating visual suggestion: ' + (err?.message || 'Unknown error'), 'error');
                    setImages(prev => {
                        const newImages = [...prev];
                        newImages[idx] = 'https://placehold.co/400x200?text=Image+Error';
                        return newImages;
                    });
                } finally {
                    setLoadingIdx(null);
                }
            },
            processed: false,
            response: '',
        });
    };

    // Handler to re-generate image for a section (after suggestion is generated)
    const handleReGenerateImage = async (idx: number) => {
        setLoadingIdx(idx);
        setError('');
        addToast('Re-generating image...', 'info');
        try {
            if (!imageModelVersion) {
                throw new Error('No image model selected.');
            }
            const suggestion = visualSuggestions[idx];
            if (!suggestion) {
                throw new Error('No visual suggestion available for this section.');
            }
            const imageUrl = await imageGeneration(apiKey, imageModelVersion, suggestion);
            if (imageUrl) {
                addToast('Image re-generated successfully!', 'success');
            } else {
                throw new Error('Image generation returned no URL.');
            }
            setImages(prev => {
                const newImages = [...prev];
                newImages[idx] = imageUrl;
                return newImages;
            });
        } catch (err: any) {
            setError('Image re-generation error: ' + (err?.message || 'Unknown error'));
            addToast('Image re-generation error: ' + (err?.message || 'Unknown error'), 'error');
            setImages(prev => {
                const newImages = [...prev];
                newImages[idx] = 'https://placehold.co/400x200?text=Image+Error';
                return newImages;
            });
        } finally {
            setLoadingIdx(null);
        }
    };

    // Handler to approve all and complete step
    const handleCompleteAll = () => {
        if (!completed) onComplete();
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">AI Visual Suggestions for Article Sections</Typography>
            <Typography variant="body2" color="text.secondary">
                This step demonstrates how AI can suggest contextually relevant visuals for each section of your article, enhancing efficiency, relevance, and engagement. For each section, you can request an AI-generated visual description and style suggestion, then approve or modify the prompt as needed.
            </Typography>
            {error && <Typography color="error">{error}</Typography>}
            {sectionPrompts.length === 0 && <Typography variant="body2">No article sections found. Please complete the previous step.</Typography>}
            {sectionPrompts.map((prompt, idx) => (
                <Card key={idx} elevation={2} sx={{ mb: 2 }}>
                    <CardContent>
                        <Typography variant="subtitle2">Section {idx + 1}</Typography>
                        <ReactMarkdown>{articleLayout.split(/\n(?=#+ )/)[idx] || ''}</ReactMarkdown>
                        <Box sx={{ mt: 1 }}>
                            <TextField
                                value={approvedPrompts[idx] || prompt}
                                onChange={e => setApprovedPrompts(prev => prev.map((p, i) => i === idx ? (e.target as HTMLInputElement).value : p))}
                                label="Visual Prompt"
                                variant="outlined"
                                multiline
                                minRows={2}
                                maxRows={6}
                                fullWidth
                            />
                        </Box>
                        <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                            <Button
                                variant="contained"
                                onClick={() => handleSuggest(idx)}
                                disabled={!!visualSuggestions[idx] || loadingIdx === idx}
                            >{loadingIdx === idx ? 'Requesting...' : visualSuggestions[idx] ? 'Suggested' : 'Suggest Visual'}</Button>
                            {visualSuggestions[idx] && (
                                <Button
                                    variant="outlined"
                                    color="secondary"
                                    onClick={() => handleReGenerateImage(idx)}
                                    disabled={loadingIdx === idx}
                                >{loadingIdx === idx ? 'Re-generating...' : 'Re-Generate Image'}</Button>
                            )}
                        </Box>
                        {visualSuggestions[idx] && (
                            <Box sx={{ mt: 2 }}>
                                <Typography variant="subtitle2">AI Visual Suggestion</Typography>
                                <Paper elevation={3} sx={{ p: 2, mb: 1, backgroundColor: '#f5f5f5' }}>
                                    <ReactMarkdown>{visualSuggestions[idx]}</ReactMarkdown>
                                    <Box sx={{ mt: 1, height: 120, backgroundColor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2 }}>
                                        {loadingIdx === idx ? (
                                            <Typography variant="body2">Generating image...</Typography>
                                        ) : images[idx] && images[idx] !== 'https://placehold.co/400x200?text=Image+Error' ? (
                                            <img src={images[idx]} alt="AI generated visual" style={{ maxHeight: 120, maxWidth: '100%', borderRadius: 8 }} />
                                        ) : images[idx] === 'https://placehold.co/400x200?text=Image+Error' ? (
                                            <Typography variant="caption" color="error">Image generation failed</Typography>
                                        ) : (
                                            <Typography variant="caption" color="text.secondary">[AI-generated image would appear here]</Typography>
                                        )}
                                    </Box>
                                </Paper>
                            </Box>
                        )}
                    </CardContent>
                </Card>
            ))}
            <SubmitRerunButtons
                onSubmit={handleCompleteAll}
                onRerun={onRetry}
                submitDisabled={completed || sectionPrompts.length === 0 || visualSuggestions.some(v => !v)}
                rerunVisible={completed}
                rerunDisabled={false}
                submitLabel="Approve All & Next"
                rerunLabel="Rerun"
            />
        </Box>
    );
};


// ArticleGenerationWorkspace: new step for article generation
const ArticleGenerationWorkspace: WorkspaceComponentType = ({ setUsageStats, setApprovalRequest, completed, onComplete, onRetry }) => {
    const { apiKey, geminiVersion, articleLayout } = useContext(AppContext);
    const { addToast } = useContext(ToastContext);
    const [article, setArticle] = useState('');
    const [error, setError] = useState('');
    const [approvalDone, setApprovalDone] = useState(false);

    useEffect(() => {
        if (completed || approvalDone || !articleLayout) return;
        setError('');
        setUsageStats({ inputLength: articleLayout.length });
        setApprovalRequest({
            suggestedPrompt: `Write a full article based on the following layout. Respond in Markdown.\n\n${articleLayout}`,
            onApproval: async (approvedPrompt: string) => {
                setApprovalRequest({
                    suggestedPrompt: approvedPrompt,
                    onApproval: () => { },
                    processed: true,
                    response: 'Awaiting response...',
                });
                try {
                    addToast('Generating article...', 'info');
                    const beginTime = performance.now();
                    const response = await promptProcessor(apiKey, geminiVersion, approvedPrompt);
                    const endTime = performance.now();
                    const timeTaken = (endTime - beginTime) / 1000;
                    setUsageStats({ inputLength: approvedPrompt.length, outputLength: response.length, timeTaken });
                    setArticle(response);
                    setApprovalRequest({
                        suggestedPrompt: approvedPrompt,
                        onApproval: () => { },
                        processed: true,
                        response,
                    });
                    setApprovalDone(true);
                    if (!completed) onComplete();
                } catch (err: any) {
                    setError(err?.message || 'Unknown error');
                    addToast('Error: ' + (err?.message || 'Unknown error'), 'error');
                }
            },
            processed: false,
            response: '',
        });
    }, [articleLayout, completed, approvalDone]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">Generated Article</Typography>
            {error && <Typography color="error">{error}</Typography>}
            {article && (
                <Box>
                    <Typography variant="subtitle2">Output:</Typography>
                    <ReactMarkdown>{article}</ReactMarkdown>
                </Box>
            )}
            {!article && !error && approvalDone && (
                <Typography>No article generated.</Typography>
            )}
            <SubmitRerunButtons
                onSubmit={() => { }}
                onRerun={onRetry}
                submitDisabled={true}
                rerunVisible={completed}
                rerunDisabled={false}
                submitLabel="Submit"
                rerunLabel="Rerun"
            />
        </Box>
    );
};


// ModelSelector component
function ModelSelector() {
    const { addToast } = useContext(ToastContext);
    const { geminiVersion, setGeminiVersion, apiKey } = useContext(AppContext);
    const [models, setModels] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!apiKey) return;
        setLoading(true);
        setError(null);
        fetchSupportedGeminiModels(apiKey)
            .then(fetchedModels => {
                setModels(fetchedModels);
                setLoading(false);

                // Select 2.5 Flash by default
                const defaultModel = fetchedModels.find((m: any) => m.name === 'models/gemini-2.5-flash');
                if (defaultModel) {
                    setGeminiVersion(defaultModel.name);
                    addToast(`Switched to ${defaultModel.displayName || defaultModel.name}`, 'info');
                } else {
                    addToast('Default model not found, please select one.', 'warning');
                }
            })
            .catch(err => {
                setError(err.message || 'Failed to fetch models');
                setLoading(false);
            });
    }, [apiKey]);

    function handleVersionChange(value: string) {
        setGeminiVersion(value);
        const model = models.find(m => m.name === value);
        addToast(`Switched to ${model?.displayName || value}`, 'info');
    }

    return (
        <Box>
            <TextField
                select
                id="gemini-version"
                value={geminiVersion}
                onChange={e => handleVersionChange((e.target as HTMLInputElement).value)}
                variant="outlined"
                disabled={loading || !apiKey}
                helperText={!apiKey ? 'Enter API key to load models' : error ? error : ''}
            >
                {loading ? (
                    <MenuItem value="" disabled>Loading models...</MenuItem>
                ) : models.length > 0 ? (
                    models.map(model => (
                        <MenuItem key={model.name} value={model.name}>
                            {model.displayName || ''} [{model.name}]
                        </MenuItem>
                    ))
                ) : (
                    <MenuItem value="" disabled>No models found</MenuItem>
                )}
            </TextField>
        </Box>
    );
}

// ImageModelSelector component
function ImageModelSelector() {
    const { addToast } = useContext(ToastContext);
    const { imageModelVersion, setImageModelVersion, apiKey } = useContext(AppContext);
    const [models, setModels] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!apiKey) return;
        setLoading(true);
        setError(null);
        fetchSupportedGeminiModels(apiKey)
            .then(fetchedModels => {
                // Filter for models that likely support image generation
                const imageModels = fetchedModels.filter((model: any) => {
                    // Heuristic: model name contains 'vision' or 'image' or 'multimodal'
                    const name = model.name.toLowerCase();
                    return name.includes('vision') || name.includes('image') || name.includes('multimodal');
                });
                setModels(imageModels);
                setLoading(false);
                if (imageModels.length > 0 && !imageModelVersion) {
                    // Use 2.0 Flash Preview as default
                    const defaultModel = imageModels.find((m: any) => m.name === 'models/gemini-2.0-flash-preview-image-generation');
                    if (defaultModel) {
                        setImageModelVersion(defaultModel.name);
                        addToast(`Image model set to ${defaultModel.displayName || defaultModel.name}`, 'info');
                    } else {
                        addToast('Default image model not found, please select one.', 'warning');
                    }
                }
            })
            .catch(err => {
                setError(err.message || 'Failed to fetch models');
                setLoading(false);
            });
    }, [apiKey]);

    function handleImageModelChange(value: string) {
        setImageModelVersion(value);
        const model = models.find(m => m.name === value);
        addToast(`Image model set to ${model?.displayName || value}`, 'info');
    }

    return (
        <Box>
            <TextField
                select
                id="image-model-version"
                value={imageModelVersion}
                onChange={e => handleImageModelChange((e.target as HTMLInputElement).value)}
                variant="outlined"
                disabled={loading || !apiKey}
                helperText={!apiKey ? 'Enter API key to load models' : error ? error : 'Select image model'}
            >
                {loading ? (
                    <MenuItem value="" disabled>Loading models...</MenuItem>
                ) : models.length > 0 ? (
                    models.map(model => (
                        <MenuItem key={model.name} value={model.name}>
                            {model.displayName || ''} [{model.name}]
                        </MenuItem>
                    ))
                ) : (
                    <MenuItem value="" disabled>No image models found</MenuItem>
                )}
            </TextField>
        </Box>
    );
}


// useSteps hook
function useSteps() {
    const steps = [
        {
            key: 'api-key',
            WorkspaceComponent: ApiKeyWorkspace,
        },
        {
            key: 'initial-prompt',
            WorkspaceComponent: InitialPromptWorkspace,
        },
        {
            key: 'domain-query',
            WorkspaceComponent: DomainQueryWorkspace,
        },
        {
            key: 'article-layout',
            WorkspaceComponent: ArticleLayoutWorkspace,
        },
        {
            key: 'visual-suggestions',
            WorkspaceComponent: VisualSuggestionWorkspace,
        },
        {
            key: 'article-generation',
            WorkspaceComponent: ArticleGenerationWorkspace,
        }
    ];

    // Track completion status for each step, dynamic length
    const [status, setStatus] = useState<boolean[]>(Array(steps.length).fill(false));

    // If steps length changes, reset status array
    useEffect(() => {
        setStatus(Array(steps.length).fill(false));
    }, [steps.length]);

    // Reset a step and all following steps
    const handleRetry = (idx: number) => {
        setStatus(prev => prev.map((s, i) => (i >= idx ? false : s)));
    };

    // Mark a step as complete
    const handleComplete = (idx: number) => {
        setStatus(prev => prev.map((s, i) => (i === idx ? true : s)));
    };

    // Only show steps up to the first incomplete one
    const visibleSteps = steps.map((step, idx) => {
        // Only show if all previous steps are complete
        if (idx === 0 || status.slice(0, idx).every(Boolean)) {
            return (
                <Step
                    key={step.key}
                    WorkspaceComponent={step.WorkspaceComponent}
                    completed={status[idx]}
                    onComplete={() => handleComplete(idx)}
                    onRetry={() => handleRetry(idx)}
                />
            );
        }
        return null;
    });
    return visibleSteps;
}

const theme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#1976d2' },
        secondary: { main: '#ff9800' },
        background: { default: '#f3f6f9', paper: '#fff' },
    },
    typography: {
        fontFamily: 'Inter, Roboto, Arial, sans-serif',
        h4: { fontWeight: 700 },
        h6: { fontWeight: 600 },
    },
    components: {
        MuiButton: {
            defaultProps: { variant: 'contained', color: 'primary' },
            styleOverrides: {
                root: { borderRadius: 8, textTransform: 'none', fontWeight: 500 }
            }
        },
        MuiTextField: {
            defaultProps: { variant: 'outlined', color: 'primary' },
            styleOverrides: {
                root: { borderRadius: 8 }
            }
        },
        MuiCard: {
            styleOverrides: {
                root: { borderRadius: 16 }
            }
        },
    },
});

function App() {
    const [apiKey, setApiKey] = useState('');
    const [geminiVersion, setGeminiVersion] = useState('');
    const [imageModelVersion, setImageModelVersion] = useState('');

    // Toast state
    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastId = useRef(0);

    const [refinedPrompt, setRefinedPrompt] = useState('');
    const [apiRequestsPerSecond, setApiRequestsPerSecond] = useState(0);
    const [domainQuestions, setDomainQuestions] = useState<Array<string>>([]);
    const [domainAnswers, setDomainAnswers] = useState<Record<string, string>>({});
    const [articleLayout, setArticleLayout] = useState('');

    // Poll global requests per second
    useEffect(() => {
        const interval = setInterval(() => {
            setApiRequestsPerSecond(apiRequestsPerSecondGlobal);
        }, 500);
        return () => clearInterval(interval);
    }, []);

    // Add toast and auto-remove after 3s
    const addToast = (message: string, severity?: Toast['severity']) => {
        const id = ++toastId.current;
        setToasts(prev => [...prev, { id, message, severity }]);
        console.log({ id, message, severity });
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 5000);
    };
    const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <ToastContext.Provider value={{ addToast }}>
                <AppContext.Provider value={{
                    apiKey, setApiKey,
                    geminiVersion, setGeminiVersion,
                    imageModelVersion, setImageModelVersion,
                    refinedPrompt, setRefinedPrompt,
                    apiRequestsPerSecond,
                    domainQuestions, setDomainQuestions,
                    domainAnswers, setDomainAnswers,
                    articleLayout, setArticleLayout
                }}>
                    <Box sx={{ fontFamily: 'Inter, Roboto, Arial, sans-serif', minHeight: '100vh', bgcolor: 'background.default' }}>
                        <AppBar position="static" color="primary" elevation={1}>
                            <Toolbar sx={{ flexDirection: 'row', alignItems: 'center', py: 1, minHeight: '64px !important', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', letterSpacing: 1 }}>
                                        Refiner
                                    </Typography>
                                    <Typography variant="body1" component="p" sx={{ opacity: 0.85 }}>
                                        Transform vague ideas into detailed articles with AI-powered refinement.
                                    </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                    <ModelSelector />
                                    <ImageModelSelector />
                                    <Typography variant="body2" sx={{ ml: 2, fontWeight: 500 }}>
                                        API req/s: {apiRequestsPerSecond}
                                    </Typography>
                                </Box>
                            </Toolbar>
                        </AppBar>
                        <Box sx={{ p: 1 }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {useSteps()}
                            </Box>
                        </Box>
                        <ToastPool toasts={toasts} removeToast={removeToast} />
                    </Box>
                </AppContext.Provider>
            </ToastContext.Provider>
        </ThemeProvider>
    );
}

// Gemini API helper
async function promptProcessor(apiKey: string, version: string, prompt: string): Promise<string> {
    if (!apiKey) throw new Error('API key is required');
    if (!version) throw new Error('Gemini version is required');
    if (!prompt) throw new Error('Prompt is required');
    return apiRequestHandler(async () => {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/${version}:generateContent`;
        const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Gemini API error: ${res.status} ${errorText}`);
        }
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    });
}

// Fetch supported Gemini models from API
async function fetchSupportedGeminiModels(apiKey: string) {
    if (!apiKey) throw new Error('API key is required');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    return apiRequestHandler(async () => {
        try {
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }
            const data = await response.json();
            const models = data.models || [];
            return models.filter((model: any) => model.supportedGenerationMethods && model.supportedGenerationMethods.includes('generateContent'));
        } catch (error) {
            console.error('Error fetching models:', error);
            throw error;
        }
    });
}

// AI Image Generation Helper
/**
 * imageGeneration - Helper to request AI-generated images for a given prompt and style.
 * @param apiKey Gemini API key
 * @param version Gemini model version
 * @param prompt Image description prompt
 * @param style Optional style (e.g., 'realistic', 'illustrative', 'anime', 'abstract')
 * @returns Promise<string> - URL or base64 string of generated image
 */
async function imageGeneration(apiKey: string, version: string, prompt: string, style?: string): Promise<string> {
    if (!apiKey) throw new Error('API key is required');
    if (!version) throw new Error('Gemini version is required');
    if (!prompt) throw new Error('Prompt is required');
    let fullPrompt = prompt;
    if (style) {
        fullPrompt += `\nStyle: ${style}`;
    }
    return apiRequestHandler(async () => {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/${version}:generateContent`;
        const res = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    candidateCount: 1,
                    responseModalities: ['TEXT', 'IMAGE'], // IMAGE only may not be supported
                },
            }),
        });
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Gemini image API error: ${res.status} ${errorText}`);
        }
        const data = await res.json();
        // Try to extract image URL or base64 from response
        const imagePart = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.fileData || p.imageUrl);
        if (imagePart?.imageUrl) return imagePart.imageUrl;
        if (imagePart?.inlineData?.data) return `data:image/png;base64,${imagePart.inlineData.data}`;
        if (imagePart?.fileData?.data) return `data:image/png;base64,${imagePart.fileData.data}`;
        // Fallback: return text or placeholder
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'https://placehold.co/400x200?text=AI+Image';
    });
}


render(<App />, document.getElementById('app')!);
