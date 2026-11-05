import React from 'react';
import {createRoot} from 'react-dom/client';
import DelayedCheckPage from '../../frontend/src/views/DelayedCheckPage.jsx';
import MixedPage from '../../frontend/src/views/MixedPage.jsx';
import SceneFeedback from '../../frontend/src/components/SceneFeedback.jsx';
import StoryCheck from '../../frontend/src/components/StoryCheck.jsx';
import LessonsPage from '../../frontend/src/views/LessonsPage.jsx';
import {useLearningAttempt} from '../../frontend/src/hooks/useLearningAttempt.js';
import {usePracticeSession} from '../../frontend/src/lib/practiceSession.js';
function Attempt() { const a = useLearningAttempt('race'); window.attempt = a; return <p>{a.phase}</p>; }
function Practice() { const a = usePracticeSession({buildItems:async()=>[{type:'spell',q:{card_id:1,word:'apple'}}],typedAttempt:()=>({source:'spelling'})}); window.practice = a; return <p>{a.phase}</p>; }
const components={DelayedCheckPage,MixedPage,SceneFeedback,StoryCheck,LessonsPage,Attempt,Practice};
const root=createRoot(document.getElementById('root'));
window.mount=(name,props={})=>root.render(React.createElement(components[name], {onExit(){},...props}));
