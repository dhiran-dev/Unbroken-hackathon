"use client";

import { ArrowDownUp, ArrowRight } from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type StationOption = {
  slug: string;
  name: string;
};

type JourneyFormProps = {
  stations: StationOption[];
  initialOrigin?: string;
  initialDestination?: string;
  submitDisabled?: boolean;
};

export function JourneyForm({
  stations,
  initialOrigin = "",
  initialDestination = "",
  submitDisabled = false,
}: JourneyFormProps) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const ready = Boolean(origin && destination && origin !== destination);

  function swapStations() {
    setOrigin(destination);
    setDestination(origin);
  }

  return (
    <form action="/" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="origin">Starting station</Label>
        <Select
          id="origin"
          name="origin"
          onChange={(event) => setOrigin(event.target.value)}
          required
          value={origin}
        >
          <option value="">Choose a station</option>
          {stations.map((station) => (
            <option
              disabled={station.slug === destination}
              key={station.slug}
              value={station.slug}
            >
              {station.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="-my-1 flex justify-center">
        <Button
          aria-label="Swap starting station and destination"
          disabled={!origin && !destination}
          onClick={swapStations}
          size="icon"
          type="button"
          variant="outline"
        >
          <ArrowDownUp />
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="destination">Destination station</Label>
        <Select
          id="destination"
          name="destination"
          onChange={(event) => setDestination(event.target.value)}
          required
          value={destination}
        >
          <option value="">Choose a station</option>
          {stations.map((station) => (
            <option
              disabled={station.slug === origin}
              key={station.slug}
              value={station.slug}
            >
              {station.name}
            </option>
          ))}
        </Select>
      </div>

      <button
        className={cn(buttonVariants({ size: "lg" }), "w-full")}
        disabled={!ready || submitDisabled}
        type="submit"
      >
        Show my step-free plan <ArrowRight />
      </button>
    </form>
  );
}
