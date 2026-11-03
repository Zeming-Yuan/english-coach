import React from "react";
import {BookOpenIcon} from "@phosphor-icons/react/dist/csr/BookOpen";
import {BookBookmarkIcon} from "@phosphor-icons/react/dist/csr/BookBookmark";
import {HouseIcon} from "@phosphor-icons/react/dist/csr/House";
import {ChartBarIcon} from "@phosphor-icons/react/dist/csr/ChartBar";
import {GearSixIcon} from "@phosphor-icons/react/dist/csr/GearSix";
import {PlusIcon} from "@phosphor-icons/react/dist/csr/Plus";
import {SpeakerHighIcon} from "@phosphor-icons/react/dist/csr/SpeakerHigh";
import {TrashIcon} from "@phosphor-icons/react/dist/csr/Trash";
import {XIcon} from "@phosphor-icons/react/dist/csr/X";
import {CheckCircleIcon} from "@phosphor-icons/react/dist/csr/CheckCircle";
import {HeadphonesIcon} from "@phosphor-icons/react/dist/csr/Headphones";
import {ArrowClockwiseIcon} from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import {PencilSimpleIcon} from "@phosphor-icons/react/dist/csr/PencilSimple";
import {TrophyIcon} from "@phosphor-icons/react/dist/csr/Trophy";
import {StarIcon} from "@phosphor-icons/react/dist/csr/Star";
import {ThumbsUpIcon} from "@phosphor-icons/react/dist/csr/ThumbsUp";
import {SmileyIcon} from "@phosphor-icons/react/dist/csr/Smiley";
import {ArrowLeftIcon} from "@phosphor-icons/react/dist/csr/ArrowLeft";
import {DotsThreeVerticalIcon} from "@phosphor-icons/react/dist/csr/DotsThreeVertical";

const icons = {book: BookOpenIcon, words: BookBookmarkIcon, home: HouseIcon, stats: ChartBarIcon, settings: GearSixIcon, plus: PlusIcon, speaker: SpeakerHighIcon, trash: TrashIcon, close: XIcon, done: CheckCircleIcon, headphones: HeadphonesIcon, refresh: ArrowClockwiseIcon, edit: PencilSimpleIcon, trophy: TrophyIcon, star: StarIcon, thumb: ThumbsUpIcon, smile: SmileyIcon};

export default function UiIcon({name, size = 20, weight = "regular", ...props}) {
  const Icon = name === "back" ? ArrowLeftIcon : name === "more" ? DotsThreeVerticalIcon : icons[name] || BookOpenIcon;
  return <Icon size={size} weight={weight} aria-hidden="true" {...props} />;
}

export const navigationIcons = {queue: "home", words: "words", stories: "book", add: "plus"};
